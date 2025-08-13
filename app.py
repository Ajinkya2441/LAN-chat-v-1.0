from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, abort, send_file, flash
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename
import os
import socket
from datetime import datetime, timedelta
from cryptography.fernet import Fernet
import base64
from sqlalchemy import or_, and_

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'  # Change this for production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat.db'
app.config['UPLOAD_FOLDER'] = 'static/uploads/'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024 * 1024 # 10 GB
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)

def get_or_create_key():
    key_file = 'instance/chat.key'
    if not os.path.exists('instance'):
        os.makedirs('instance')
    if os.path.exists(key_file):
        with open(key_file, 'rb') as f:
            return f.read()
    else:
        key = Fernet.generate_key()
        with open(key_file, 'wb') as f:
            f.write(key)
        return key
 
# Initialize Fernet cipher
FERNET_KEY = get_or_create_key()
cipher_suite = Fernet(FERNET_KEY)
 
def encrypt_message(message):
    if not message:
        return message
    return cipher_suite.encrypt(message.encode()).decode()
 
def decrypt_message(encrypted_message):
    if not encrypted_message:
        return encrypted_message
    try:
        return cipher_suite.decrypt(encrypted_message.encode()).decode()
    except:
        return "Message decryption failed"
 
 

ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'mp3', 'wav', 'ogg', 'svg', 'heic', 'jfif', 'py','ipynb','html','css','js','json','xml','yaml','yml ','md','markdown','exe','apk','iso','tar', 'msi'}

db = SQLAlchemy(app)
# Use eventlet for async_mode (required for Flask-SocketIO real-time features)
socketio = SocketIO(app, async_mode='eventlet')

# --- Database Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(128), nullable=False)  # New: store hashed password
    online = db.Column(db.Boolean, default=False)
    is_admin = db.Column(db.Boolean, default=False)  # New: admin flag
    created_by = db.Column(db.String(80), nullable=True)  # New: who created this user (admin username)
    
    def __init__(self, username, password, online=False, is_admin=False, created_by=None):
        self.username = username
        self.password = password
        self.online = online
        self.is_admin = is_admin
        self.created_by = created_by

class UserRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(128), nullable=False)  # store hashed password
    requested_by = db.Column(db.String(80), nullable=True)  # who requested (self or admin)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    approved_by = db.Column(db.String(80), nullable=True)  # admin who approved
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __init__(self, username, password, requested_by=None, status='pending', approved_by=None):
        self.username = username
        self.password = password
        self.requested_by = requested_by
        self.status = status
        self.approved_by = approved_by

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(80), nullable=False)
    recipients = db.Column(db.String(255), nullable=False)  # comma-separated usernames or 'all'
    content = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    file_id = db.Column(db.Integer, db.ForeignKey('file.id'), nullable=True)
    status = db.Column(db.String(20), default='sent')  # 'sent' or 'read'
    reply_to = db.Column(db.Integer, db.ForeignKey('message.id'), nullable=True)  # New: replied message id
    reactions = db.Column(db.Text, nullable=True)  # New: JSON string of reactions
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=True)  # New: group message support
    
    def __init__(self, sender, recipients, content=None, file_id=None, status='sent', reply_to=None, reactions=None, group_id=None):
        self.sender = sender
        self.recipients = recipients
        self.content = content
        self.file_id = file_id
        self.status = status
        self.reply_to = reply_to
        self.reactions = reactions
        self.group_id = group_id

class File(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255), nullable=False)
    uploader = db.Column(db.String(80), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    mimetype = db.Column(db.String(80), nullable=False)
    
    def __init__(self, filename, original_name, uploader, mimetype):
        self.filename = filename
        self.original_name = original_name
        self.uploader = uploader
        self.mimetype = mimetype

class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255), nullable=True)  # New: group description
    icon = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    admin_only = db.Column(db.Boolean, default=False)  # New: only admins can send messages
    
    def __init__(self, name, created_by, description=None, icon=None, admin_only=False):
        self.name = name
        self.description = description
        self.icon = icon
        self.created_by = created_by
        self.admin_only = admin_only

class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    username = db.Column(db.String(80), db.ForeignKey('user.username'), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __init__(self, group_id, username, is_admin=False):
        self.group_id = group_id
        self.username = username
        self.is_admin = is_admin

class PasswordResetRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), db.ForeignKey('user.username'), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    requested_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_by = db.Column(db.String(80), nullable=True)
    approved_at = db.Column(db.DateTime, nullable=True)
    
    def __init__(self, username, status='pending', approved_by=None):
        self.username = username
        self.status = status
        self.approved_by = approved_by

# --- In-memory set to track online users ---
online_users = set()

# --- Helper Functions ---
def allowed_file(filename):
    """Check if the file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_host_ip():
    """Get the local IP address of the host for LAN access."""
    try:
        return socket.gethostbyname(socket.gethostname())
    except:
        return 'localhost'

# --- Routes ---
@app.route('/')
def index():
    """Welcome page that redirects to dashboard or login."""
    if 'username' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    """User login page. Requires username and password."""
    error = None
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form.get('password', '')
        user = User.query.filter_by(username=username).first()
        if not user:
            error = 'User not found or not approved.'
        elif cipher_suite.decrypt(user.password).decode() != password:
            error = 'Invalid password.'
        else:
            session['username'] = username
            session['is_admin'] = user.is_admin
            session.permanent = True  # Make session persistent
            user.online = True
            db.session.commit()
            return redirect(url_for('dashboard'))
    return render_template('login.html', error=error, host_ip=get_host_ip())

@app.route('/chat')
def chat():
    """Redirect to the new chats page for backward compatibility."""
    if 'username' not in session:
        return redirect(url_for('login'))
    return redirect(url_for('chats'))

@app.route('/dashboard')
def dashboard():
    """Main dashboard page. Requires login."""
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip())

@app.route('/chats')
def chats():
    """Chats page - shows the chat interface."""
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='chats')

@app.route('/add-user', methods=['GET', 'POST'])
def add_user():
    """Add User page. Requires admin login."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    
    message = None
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'create_user':
            new_username = request.form.get('new_username', '').strip().title()
            new_password = request.form.get('new_password')
            is_admin = bool(request.form.get('new_is_admin'))
            if not new_username or not new_password:
                flash('Username and password required.', 'error')
                return redirect(url_for('add_user'))
            elif User.query.filter_by(username=new_username).first():
                flash('Username already exists.', 'error')
                return redirect(url_for('add_user'))
            else:
                user = User(
                    username=new_username,
                    password=cipher_suite.encrypt(new_password.encode()),
                    is_admin=is_admin,
                    created_by=session['username']
                )
                db.session.add(user)
                db.session.commit()
                flash(f'User {new_username} created successfully!', 'success')
                return redirect(url_for('add_user'))
    
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='add-user', message=message)

@app.route('/pending-requests', methods=['GET', 'POST'])
def pending_requests():
    """Pending Requests page. Requires admin login."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    
    message = None
    if request.method == 'POST':
        action = request.form.get('action')
        req_id = request.form.get('req_id')
        req = UserRequest.query.get(req_id) if req_id else None
        if req and action == 'approve':
            user = User(
                username=req.username,
                password=req.password,
                is_admin=False,
                created_by=session['username']
            )
            db.session.add(user)
            req.status = 'approved'
            req.approved_by = session['username']
            db.session.commit()
            flash(f'Request for {req.username} approved successfully!', 'success')
            return redirect(url_for('pending_requests'))
        elif req and action == 'reject':
            req.status = 'rejected'
            req.approved_by = session['username']
            db.session.commit()
            flash(f'Request for {req.username} rejected successfully!', 'success')
            return redirect(url_for('pending_requests'))
    
    requests = UserRequest.query.order_by(UserRequest.timestamp.desc()).all()
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='pending-requests', requests=requests, message=message)

@app.route('/reset-requests', methods=['GET', 'POST'])
def reset_requests():
    """Password Reset Requests page. Requires admin login."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    
    message = None
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'approve_reset':
            reset_id = request.form.get('reset_id')
            req = PasswordResetRequest.query.get(reset_id)
            if req and req.status == 'pending':
                req.status = 'approved'
                req.approved_by = session['username']
                req.approved_at = datetime.utcnow()
                db.session.commit()
                flash(f'Password reset for {req.username} approved. Tell the user to visit /reset_password?username={req.username} to set a new password.', 'success')
                return redirect(url_for('reset_requests'))
        elif action == 'reject_reset':
            reset_id = request.form.get('reset_id')
            req = PasswordResetRequest.query.get(reset_id)
            if req and req.status == 'pending':
                req.status = 'rejected'
                req.approved_by = session['username']
                req.approved_at = datetime.utcnow()
                db.session.commit()
                flash(f'Password reset for {req.username} rejected successfully!', 'success')
                return redirect(url_for('reset_requests'))
    
    reset_requests = PasswordResetRequest.query.order_by(PasswordResetRequest.requested_at.desc()).all()
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='reset-requests', reset_requests=reset_requests, message=message)

@app.route('/all-users', methods=['GET', 'POST'])
def all_users():
    """All Users page. Requires admin login."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    
    message = None
    if request.method == 'POST':
        action = request.form.get('action')
        user_id = request.form.get('user_id')
        user = User.query.get(user_id)
        
        if user:
            if action == 'delete_user':
                if not user.is_admin:
                    db.session.delete(user)
                    db.session.commit()
                    flash(f'User {user.username} deleted successfully!', 'success')
                    return redirect(url_for('all_users'))
                else:
                    flash(f'Cannot delete admin user {user.username}.', 'error')
                    return redirect(url_for('all_users'))
            elif action == 'promote_admin':
                if not user.is_admin:
                    user.is_admin = True
                    user.created_by = session['username']
                    db.session.commit()
                    flash(f'User {user.username} promoted to admin successfully!', 'success')
                    return redirect(url_for('all_users'))
                else:
                    flash(f'User {user.username} is already an admin.', 'error')
                    return redirect(url_for('all_users'))
            elif action == 'demote_admin':
                if user.is_admin:
                    # Prevent demoting the last admin
                    admin_count = User.query.filter_by(is_admin=True).count()
                    if admin_count > 1:
                        user.is_admin = False
                        db.session.commit()
                        flash(f'User {user.username} demoted from admin successfully!', 'success')
                        return redirect(url_for('all_users'))
                    else:
                        flash(f'Cannot demote {user.username}. At least one admin must remain in the system.', 'error')
                        return redirect(url_for('all_users'))
                else:
                    flash(f'User {user.username} is not an admin.', 'error')
                    return redirect(url_for('all_users'))
    
    users = User.query.all()
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='all-users', users=users, message=message)

@app.route('/admins')
def admins():
    """Admins page. Requires admin login."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    
    users = User.query.all()
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='admins', users=users)

@app.route('/logout')
def logout():
    """Logout the user and update online status."""
    username = session.get('username')
    if username:
        user = User.query.filter_by(username=username).first()
        if user:
            user.online = False
            db.session.commit()
        online_users.discard(username)
        session.pop('username', None)
    return redirect(url_for('login'))

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Serve uploaded files from the uploads directory. If ?download=1, force download."""
    as_attachment = request.args.get('download') == '1'
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=as_attachment)

@app.route('/history')
def history():
    """Return recent messages for the user, private chat, or group chat (no public chat)."""
    import json
    if 'username' not in session:
        return jsonify([])
    username = session['username']
    filter_user = request.args.get('user')
    group_id = request.args.get('group_id')
    if group_id:
        group_room = f'group-{group_id}'
        msgs = Message.query.filter_by(recipients=group_room).order_by(Message.timestamp.desc()).limit(50).all()
    elif filter_user == username:
        msgs = Message.query.filter(
            or_(
                getattr(Message, "sender") == username,
                getattr(Message, "recipients").like(f'%{username}%')
            )
        ).order_by(Message.timestamp.desc()).limit(50).all()
    elif filter_user and filter_user.startswith('group-'):
        msgs = Message.query.filter_by(recipients=filter_user).order_by(Message.timestamp.desc()).limit(50).all()
    else:
        msgs = Message.query.filter(
            or_(
                and_(getattr(Message, "sender") == username, getattr(Message, "recipients").like(f'%{filter_user}%')),
                and_(getattr(Message, "sender") == filter_user, getattr(Message, "recipients").like(f'%{username}%'))
            )
        ).order_by(Message.timestamp.desc()).limit(50).all()
    result = []
    for m in reversed(msgs):
        file_info = None
        if m.file_id:
            f = File.query.get(m.file_id)
            if f:
                file_info = {
                    'filename': f.filename,
                    'original_name': f.original_name,
                    'mimetype': f.mimetype
                }
        reply_msg = None
        if m.reply_to:
            reply = Message.query.get(m.reply_to)
            if reply:
                reply_msg = {
                    'id': reply.id,
                    'sender': reply.sender,
                    'content': reply.content,
                    'timestamp': reply.timestamp.isoformat() + 'Z' if reply.timestamp else None
                }
        result.append({
            'id': m.id,
            'sender': m.sender,
            'recipients': m.recipients,
            'content': decrypt_message(m.content) if m.content else '',
            'timestamp': m.timestamp.isoformat() + 'Z' if m.timestamp else None,
            'file': file_info,
            'status': m.status,
            'reply_to': reply_msg,
            'reactions': json.loads(m.reactions) if m.reactions else {},
            'group_id': m.group_id
        })
    return jsonify(result)

@app.route('/users')
def users():
    """Return the list of currently online users."""
    users = User.query.filter_by(online=True).all()
    return jsonify([u.username for u in users])

@app.route('/users_status')
def users_status():
    """Return all users and their online status."""
    users = User.query.all()
    return jsonify([{ 'username': u.username, 'online': u.online } for u in users])

@app.route('/upload', methods=['POST'])
def upload():
    """Handle file uploads and save metadata to the database."""
    if 'username' not in session:
        return jsonify({'error': 'Login required'}), 403
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if not file.filename or file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file'}), 400
    filename = secure_filename(file.filename)
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    i = 1
    while os.path.exists(save_path):
        filename = f"{os.path.splitext(secure_filename(file.filename))[0]}_{i}{os.path.splitext(file.filename)[1]}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        i += 1
    file.save(save_path)
    f = File(filename=filename, original_name=file.filename, uploader=session['username'], mimetype=file.mimetype)
    db.session.add(f)
    db.session.commit()
    return jsonify({'file_id': f.id, 'filename': filename, 'original_name': file.filename, 'mimetype': file.mimetype})

@app.route('/delete_message/<int:msg_id>', methods=['POST'])
def delete_message(msg_id):
    """Delete a message and optionally its associated file. Allow if user is sender or recipient."""
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    username = session['username']
    msg = Message.query.get(msg_id)
    # Allow delete if user is sender or recipient (private/group)
    allowed = False
    if msg:
        if msg.sender == username:
            allowed = True
        elif username in msg.recipients.split(','):
            allowed = True
        elif username == 'admin':
            allowed = True
    if not msg or not allowed:
        return jsonify({'success': False, 'error': 'Not allowed'}), 403
    # If message has a file, optionally delete the file too
    if msg.file_id:
        file = File.query.get(msg.file_id)
        if file:
            try:
                os.remove(os.path.join(app.config['UPLOAD_FOLDER'], file.filename))
            except Exception:
                pass
            db.session.delete(file)
    db.session.delete(msg)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/delete_file/<int:file_id>', methods=['POST'])
def delete_file(file_id):
    """Delete a file and all messages referencing it."""
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    username = session['username']
    file = File.query.get(file_id)
    if not file or (file.uploader != username and username != 'admin'):
        return jsonify({'success': False, 'error': 'Not allowed'}), 403
    try:
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], file.filename))
    except Exception:
        pass
    # Remove all messages referencing this file
    Message.query.filter_by(file_id=file_id).delete()
    db.session.delete(file)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    """Signup page for new users. Requires username and password only."""
    error = None
    success = None
    if request.method == 'POST':
        username = request.form['username'].strip().title()
        password = request.form['password']
        # Removed app_password check
        if not username or not password:
            error = 'Username and password required.'
        elif User.query.filter_by(username=username).first() or UserRequest.query.filter_by(username=username).first():
            error = 'Username already exists or pending approval.'
        else:
            req = UserRequest(
                username=username,
                password=cipher_suite.encrypt(password.encode()),
                requested_by=username,
                status='pending'
            )
            db.session.add(req)
            db.session.commit()
            # Real-time: notify all admins
            socketio.emit('new_user_request', {'username': username, 'requested_by': username})
            success = 'Signup request submitted. Wait for admin approval.'
    return render_template('signup.html', error=error, success=success)

@app.route('/admin', methods=['GET', 'POST'])
def admin_dashboard():
    """Redirect to the new add-user page for backward compatibility."""
    if 'username' not in session or not session.get('is_admin'):
        return redirect(url_for('login'))
    return redirect(url_for('add_user'))

@app.route('/groups', methods=['GET'])
def get_user_groups():
    """Return all groups the current user is a member of."""
    if 'username' not in session:
        return jsonify([])
    username = session['username']
    group_ids = [gm.group_id for gm in GroupMember.query.filter_by(username=username)]
    groups = Group.query.filter(Group.id.in_(group_ids)).all()
    result = []
    for g in groups:
        result.append({
            'id': g.id,
            'name': g.name,
            'icon': g.icon,
            'created_by': g.created_by,
            'created_at': g.created_at.strftime('%Y-%m-%d %H:%M')
        })
    return jsonify(result)

@app.route('/groups', methods=['POST'])
@app.route('/groups/', methods=['POST'])
def create_group():
    """Create a new group with name, description, members, admins, and optional icon."""
    if 'username' not in session:
        return jsonify({'error': 'Login required'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON data'}), 400
    name = data.get('name')
    description = data.get('description')
    members = data.get('members', [])
    admins = data.get('admins', [])
    icon = data.get('icon')
    if not name or not members:
        return jsonify({'error': 'Name and members required'}), 400
    if session['username'] not in members:
        members.append(session['username'])
    if session['username'] not in admins:
        admins.append(session['username'])
    group = Group(name=name, description=description, icon=icon, created_by=session['username'])
    db.session.add(group)
    db.session.commit()
    # Add members and admins
    for m in set(members):
        gm = GroupMember(group_id=group.id, username=m, is_admin=(m in admins))
        db.session.add(gm)
    db.session.commit()
    return jsonify({'success': True, 'group_id': group.id})

@app.route('/groups/<int:group_id>', methods=['GET'])
def get_group_info(group_id):
    """Get group info, members, and admins."""
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    members = GroupMember.query.filter_by(group_id=group_id).all()
    member_list = [{'username': m.username, 'is_admin': m.is_admin} for m in members]
    is_admin = False
    if 'username' in session:
        is_admin = any(m.username == session['username'] and m.is_admin for m in members)
    return jsonify({
        'id': group.id,
        'name': group.name,
        'description': group.description,
        'icon': group.icon,
        'created_by': group.created_by,
        'created_at': group.created_at.strftime('%Y-%m-%d %H:%M'),
        'members': member_list,
        'is_admin': is_admin,
        'admin_only': group.admin_only
    })

@app.route('/groups/<int:group_id>/add_member', methods=['POST'])
def add_group_member(group_id):
    """Add a member to a group (admin only)."""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'error': 'Only admins can add members'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON data'}), 400
    new_member = data.get('username')
    if not new_member:
        return jsonify({'error': 'Username required'}), 400
    if GroupMember.query.filter_by(group_id=group_id, username=new_member).first():
        return jsonify({'error': 'User already in group'}), 400
    gm = GroupMember(group_id=group_id, username=new_member, is_admin=False)
    db.session.add(gm)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/groups/<int:group_id>/remove_member', methods=['POST'])
def remove_group_member(group_id):
    """Remove a member from a group (admin only)."""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'error': 'Only admins can remove members'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON data'}), 400
    member = data.get('username')
    if not member:
        return jsonify({'error': 'Username required'}), 400
    gm = GroupMember.query.filter_by(group_id=group_id, username=member).first()
    if not gm:
        return jsonify({'error': 'User not in group'}), 400
    db.session.delete(gm)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/groups/<int:group_id>/set_admin', methods=['POST'])
def set_group_admin(group_id):
    """Assign or remove admin rights for a group member (admin only)."""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'error': 'Only admins can assign/remove admin rights'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON data'}), 400
    member = data.get('username')
    make_admin = data.get('is_admin', True)
    gm = GroupMember.query.filter_by(group_id=group_id, username=member).first()
    if not gm:
        return jsonify({'error': 'User not in group'}), 400
    gm.is_admin = make_admin
    db.session.commit()
    return jsonify({'success': True, 'is_admin': gm.is_admin})

@app.route('/groups/<int:group_id>/leave', methods=['POST'])
def leave_group(group_id):
    """Leave a group (if admin, must assign another admin if last admin)."""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    gm = GroupMember.query.filter_by(group_id=group_id, username=session['username']).first()
    if not gm:
        return jsonify({'error': 'You are not a member of this group'}), 400
    if gm.is_admin:
        # Check if this is the last admin
        admin_count = GroupMember.query.filter_by(group_id=group_id, is_admin=True).count()
        if admin_count == 1:
            # Must assign another admin before leaving
            return jsonify({'error': 'Assign another admin before leaving'}), 400
    db.session.delete(gm)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/groups/<int:group_id>/update', methods=['POST'])
def update_group_info(group_id):
    """Update group name, description, or icon (admin only)."""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'error': 'Only admins can update group info'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON data'}), 400
    name = data.get('name')
    description = data.get('description')
    icon = data.get('icon')
    if name:
        group.name = name
    if description is not None:
        group.description = description
    if icon:
        group.icon = icon
    db.session.commit()
    return jsonify({'success': True})

@app.route('/groups/<int:group_id>/set_members_admins', methods=['POST'])
def set_members_admins(group_id):
    """Update group members and admins (admin only)."""
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'success': False, 'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'success': False, 'error': 'Only admins can update members/admins'}), 403
    data = request.get_json(force=True)
    members = data.get('members', [])
    admins = data.get('admins', [])
    # Remove all current members
    GroupMember.query.filter_by(group_id=group_id).delete()
    # Add new members and set admin status
    for m in set(members):
        is_admin = m in admins
        gm = GroupMember(group_id=group_id, username=m, is_admin=is_admin)
        db.session.add(gm)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/groups/<int:group_id>/admin_only', methods=['POST'])
def set_group_admin_only(group_id):
    """Set whether only admins can send messages in the group (admin only)."""
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'success': False, 'error': 'Group not found'}), 404
    admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
    if not admin:
        return jsonify({'success': False, 'error': 'Only admins can update this setting'}), 403
    data = request.get_json(force=True)
    admin_only = data.get('admin_only', False)
    group.admin_only = bool(admin_only)
    db.session.commit()
    return jsonify({'success': True, 'admin_only': group.admin_only})

@app.route('/groups/<int:group_id>/delete', methods=['POST'])
def delete_group(group_id):
    """Delete a group and all its members and messages (admin only)."""
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'}), 401
        group = Group.query.get(group_id)
        if not group:
            return jsonify({'success': False, 'error': 'Group not found'}), 404
        admin = GroupMember.query.filter_by(group_id=group_id, username=session['username'], is_admin=True).first()
        if not admin:
            return jsonify({'success': False, 'error': 'Only admins can delete group'}), 403
        # Delete all group messages
        group_room = f'group-{group_id}'
        Message.query.filter_by(recipients=group_room).delete()
        # Delete all group members
        GroupMember.query.filter_by(group_id=group_id).delete()
        # Delete all group mutes
        GroupMute.query.filter_by(group_id=group_id).delete()
        # Delete the group itself
        db.session.delete(group)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        import traceback
        print('Error deleting group:', e)
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# --- Group mute/unmute (per user) ---
class GroupMute(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    username = db.Column(db.String(80), db.ForeignKey('user.username'), nullable=False)
    __table_args__ = (db.UniqueConstraint('group_id', 'username', name='unique_group_mute'),)
    
    def __init__(self, group_id, username):
        self.group_id = group_id
        self.username = username

@app.route('/groups/<int:group_id>/mute', methods=['POST'])
def mute_group(group_id):
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    if not GroupMute.query.filter_by(group_id=group_id, username=session['username']).first():
        mute = GroupMute(group_id=group_id, username=session['username'])
        db.session.add(mute)
        db.session.commit()
    return jsonify({'success': True, 'muted': True})

@app.route('/groups/<int:group_id>/unmute', methods=['POST'])
def unmute_group(group_id):
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    mute = GroupMute.query.filter_by(group_id=group_id, username=session['username']).first()
    if mute:
        db.session.delete(mute)
        db.session.commit()
    return jsonify({'success': True, 'muted': False})

# Update group info endpoint to include mute status for current user
@app.route('/groups/<int:group_id>/info', methods=['GET'])
def get_group_info_full(group_id):
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    members = GroupMember.query.filter_by(group_id=group_id).all()
    member_list = [{'username': m.username, 'is_admin': m.is_admin} for m in members]
    muted = False
    if 'username' in session:
        muted = GroupMute.query.filter_by(group_id=group_id, username=session['username']).first() is not None
    return jsonify({
        'id': group.id,
        'name': group.name,
        'icon': group.icon,
        'created_by': group.created_by,
        'created_at': group.created_at.strftime('%Y-%m-%d %H:%M'),
        'members': member_list,
        'muted': muted
    })

@app.route('/reset_password', methods=['GET', 'POST'])
def reset_password():
    """Step 1: User requests password reset (username only). Step 2: If approved, user can reset password."""
    error = None
    success = None
    show_reset_form = False
    username = request.args.get('username') or request.form.get('username')
    if request.method == 'POST':
        new_password = request.form.get('new_password')
        confirm_password = request.form.get('confirm_password')
        if new_password and confirm_password:
            # Check for approved reset request
            req = PasswordResetRequest.query.filter_by(username=username, status='approved').first()
            user = User.query.filter_by(username=username).first()
            if not user:
                error = 'User not found.'
            elif not req:
                error = 'Your reset request is not approved yet.'
            elif new_password != confirm_password:
                error = 'Passwords do not match.'
                show_reset_form = True
            else:
                user.password = cipher_suite.encrypt(new_password.encode())
                # Mark the reset request as used instead of deleting
                req.status = 'used'
                req.approved_at = datetime.utcnow()
                db.session.commit()
                success = 'Password reset successful. You can now log in.'
        else:
            # Step 1: Create/reset request
            if not username:
                error = 'Username required.'
            else:
                user = User.query.filter_by(username=username).first()
                if not user:
                    error = 'User not found.'
                else:
                    existing = PasswordResetRequest.query.filter(
                        getattr(PasswordResetRequest, "username") == username,
                        getattr(PasswordResetRequest, "status").in_(['pending', 'approved'])
                    ).first()
                    if existing:
                        if existing.status == 'pending':
                            error = 'A reset request is already pending approval.'
                        elif existing.status == 'approved':
                            error = 'Your reset request is already approved. <a href="/reset_password?username={}">Click here to set a new password.</a>'.format(username)
                            show_reset_form = False
                        else:
                            error = 'A reset request already exists.'
                    else:
                        req = PasswordResetRequest(username=username)
                        db.session.add(req)
                        db.session.commit()
                        # Real-time: notify all admins for password reset request
                        socketio.emit('new_password_reset_request', {'username': username})
                        success = 'Reset request submitted. Wait for admin approval.'
    # If GET with ?username=... and approved, show reset form
    if username:
        req = PasswordResetRequest.query.filter_by(username=username, status='approved').first()
        if req:
            show_reset_form = True
    return render_template('reset_password.html', error=error, success=success, show_reset_form=show_reset_form, username=username)

@app.route('/register')
def register():
    """Fetch and decode all data from the database."""
    users = User.query.all()
    messages = Message.query.all()
    files = File.query.all()
 
    # Decode and format data
    user_data = [
        {
            'id': user.id,
            'username': user.username,
            'password': decrypt_message(user.password) if user.password else '',
            'online': user.online,
            'is_admin': user.is_admin,
            'created_by': user.created_by
        }
        for user in users
    ]
 
    message_data = [
        {
            'id': message.id,
            'sender': message.sender,
            'recipients': message.recipients,
            'content': decrypt_message(message.content) if message.content else '',
            'timestamp': message.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'status': message.status,
            'reply_to': message.reply_to,
            'reactions': message.reactions
        }
        for message in messages
    ]
 
    file_data = [
        {
            'id': file.id,
            'filename': file.filename,
            'original_name': file.original_name,
            'uploader': file.uploader,
            'timestamp': file.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'mimetype': file.mimetype
        }
        for file in files
    ]
 
    return render_template('register.html', users=user_data, messages=message_data, files=file_data)
 
 


# --- SocketIO Events for Real-Time Features ---
@socketio.on('connect')
def handle_connect():
    """Handle new WebSocket connection and update online users."""
    username = session.get('username')
    if username:
        online_users.add(username)
        user = User.query.filter_by(username=username).first()
        if user:
            user.online = True
            db.session.commit()
        emit('user_list', list(online_users), broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnect and update online users."""
    username = session.get('username')
    if username:
        online_users.discard(username)
        user = User.query.filter_by(username=username).first()
        if user:
            user.online = False
            db.session.commit()

@socketio.on('join')
def on_join(data):
    """Join a private or group chat room."""
    room = data.get('room')
    join_room(room)

@socketio.on('leave')
def on_leave(data):
    """Leave a private or group chat room."""
    room = data.get('room')
    leave_room(room)

@socketio.on('send_message')
def handle_message(data):
    """Handle sending messages (public, private, group) and broadcast to recipients."""
    import json
    sender = session.get('username')
    recipients = data.get('recipients', 'all')
    content = data.get('content', '')
    encrypted_content = encrypt_message(content) if content else None
    file_id = data.get('file_id')
    reply_to = data.get('reply_to')  # New: replied message id

    # --- Admin-only group message enforcement ---
    if recipients.startswith('group-'):
        try:
            group_id = int(recipients.split('-')[1])
            group = Group.query.get(group_id)
            if group and group.admin_only:
                gm = GroupMember.query.filter_by(group_id=group_id, username=sender).first()
                if not gm or not gm.is_admin:
                    emit('group_admin_only_error', {'error': 'Only admins can send messages in this group.'}, to=sender)
                    return  # Do not process message
        except Exception as e:
            emit('group_admin_only_error', {'error': 'Group admin check failed.'}, to=sender)
            return

    msg = Message(sender=sender, recipients=recipients, content=encrypted_content, file_id=file_id, status='sent', reply_to=reply_to)
    db.session.add(msg)
    db.session.commit()
    # Fetch reply message if any
    reply_msg = None
    if reply_to:
        reply = Message.query.get(reply_to)
        if reply:
            reply_msg = {
                'id': reply.id,
                'sender': reply.sender,
                'content': decrypt_message(reply.content) if reply.content else '',
                'timestamp': reply.timestamp.strftime('%Y-%m-%dT%H:%M:%SZ') if reply.timestamp else None
            }
    msg_data = {
        'id': msg.id,
        'sender': sender,
        'recipients': recipients,
        'content': decrypt_message(msg.content) if msg.content else '',
        'timestamp': msg.timestamp.strftime('%Y-%m-%dT%H:%M:%SZ') if msg.timestamp else None,
        'file': None,
        'status': msg.status,
        'reply_to': reply_msg,
        'reactions': json.loads(msg.reactions) if msg.reactions else {},
        'group_id': msg.group_id
    }
    if file_id:
        f = File.query.get(file_id)
        if f:
            msg_data['file'] = {
                'filename': f.filename,
                'original_name': f.original_name,
                'mimetype': f.mimetype
            }
    if recipients == 'all':
        emit('receive_message', msg_data, broadcast=True)
    elif recipients.startswith('group-'):
        emit('receive_message', msg_data, to=recipients)
    else:
        for r in recipients.split(','):
            emit('receive_message', msg_data, to=r.strip())
        emit('receive_message', msg_data, to=sender)

# New: React to a message
@socketio.on('react_message')
def handle_react_message(data):
    import json
    msg_id = data.get('msg_id')
    emoji = data.get('emoji')
    username = session.get('username')
    msg = Message.query.get(msg_id)
    if msg and emoji and username:
        reactions = json.loads(msg.reactions) if msg.reactions else {}
        if emoji not in reactions:
            reactions[emoji] = []
        if username not in reactions[emoji]:
            reactions[emoji].append(username)
        msg.reactions = json.dumps(reactions)
        db.session.commit()
        emit('update_reactions', {'msg_id': msg_id, 'reactions': reactions}, broadcast=True)

# New: Remove reaction
@socketio.on('remove_reaction')
def handle_remove_reaction(data):
    import json
    msg_id = data.get('msg_id')
    emoji = data.get('emoji')
    username = session.get('username')
    msg = Message.query.get(msg_id)
    if msg and emoji and username:
        reactions = json.loads(msg.reactions) if msg.reactions else {}
        if emoji in reactions and username in reactions[emoji]:
            reactions[emoji].remove(username)
            if not reactions[emoji]:
                del reactions[emoji]
            msg.reactions = json.dumps(reactions)
            db.session.commit()
            emit('update_reactions', {'msg_id': msg_id, 'reactions': reactions}, broadcast=True)

@socketio.on('message_read')
def handle_message_read(data):
    """Mark a message as read and notify the sender."""
    msg_id = data.get('msg_id')
    username = session.get('username')
    msg = Message.query.get(msg_id)
    if msg and username and (username in msg.recipients.split(',') or msg.recipients == username):
        msg.status = 'read'
        db.session.commit()
        # Notify the sender
        emit('message_read', {'msg_id': msg_id}, to=msg.sender)

@socketio.on('typing')
def handle_typing(data):
    to = data.get('to')
    sender = session.get('username')
    if to and sender:
        if to.startswith('group-'):
            emit('show_typing', {'from': sender, 'room': to}, to=to, include_self=False)
        else:
            emit('show_typing', {'from': sender}, to=to)

@socketio.on('stop_typing')
def handle_stop_typing(data):
    to = data.get('to')
    sender = session.get('username')
    if to and sender:
        if to.startswith('group-'):
            emit('hide_typing', {'from': sender, 'room': to}, to=to, include_self=False)
        else:
            emit('hide_typing', {'from': sender}, to=to)

@socketio.on('group_deleted')
def handle_group_deleted(data):
    group_id = data.get('group_id')
    emit('group_deleted', {'group_id': group_id}, broadcast=True)

@app.route('/clear_chat', methods=['POST'])
def clear_chat():
    """Clear chat history for the current user and selected chat (private chat only)."""
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    username = session['username']
    other_user = request.form.get('user')
    if not other_user:
        return jsonify({'success': False, 'error': 'No user specified'}), 400
    from sqlalchemy import or_, and_
    messages = Message.query.filter(
        or_(
            and_(getattr(Message, 'sender') == username, getattr(Message, 'recipients').like(f'%{other_user}%')),
            and_(getattr(Message, 'sender') == other_user, getattr(Message, 'recipients').like(f'%{username}%'))
        )
    ).all()
    for m in messages:
        db.session.delete(m)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/unread_counts')
def unread_counts():
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    username = session['username']
    # Count unread private messages
    unread_chats = Message.query.filter(
        Message.recipients.like(f'%{username}%'),
        Message.status != 'read',
        Message.group_id == None
    ).count()
    # Count unread group messages
    group_ids = [gm.group_id for gm in GroupMember.query.filter_by(username=username).all()]
    unread_groups = Message.query.filter(
        Message.group_id.in_(group_ids),
        Message.status != 'read',
        Message.sender != username
    ).count() if group_ids else 0
    return jsonify({'chats': unread_chats, 'groups': unread_groups})

@app.route('/files_data')
def files_data():
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    username = session['username']
    # Find all messages where user is sender or in recipients and has a file
    messages = Message.query.filter(
        or_(
            Message.sender == username,
            Message.recipients.like(f'%{username}%')
        ),
        Message.file_id != None
    ).order_by(Message.timestamp.desc()).all()
    files = []
    for msg in messages:
        file = File.query.get(msg.file_id)
        if not file:
            continue
        files.append({
            'filename': file.filename,
            'original_name': file.original_name,
            'mimetype': file.mimetype,
            'sender': msg.sender,
            'recipients': msg.recipients,
            'timestamp': msg.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'download_url': url_for('uploaded_file', filename=file.filename)
        })
    return jsonify({'files': files})

@app.route('/files')
def files():
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('dashboard.html', username=session['username'], host_ip=get_host_ip(), active_section='files')

# --- Main Entrypoint ---
if __name__ == '__main__':
    import signal
    import sys
    
    def signal_handler(sig, frame):
        print('\nShutting down LANChat server...')
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    # Ensure upload directory exists
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    with app.app_context():
        db.create_all()
        # --- Add default admins only if they don't exist ---
        admin_list: list[dict[str, str]] = [
            {'username': 'Vicky', 'password': 'vickyadmin'},
            {'username': 'Ajinkya', 'password': 'ajinkyaadmin'}
        ]
        for admin in admin_list:
            # Check if admin already exists
            existing_user = User.query.filter_by(username=admin['username']).first()
            if not existing_user:
                user = User(
                    username=admin['username'],
                    password=cipher_suite.encrypt(admin['password'].encode()).decode(),  # Store as string
                    is_admin=True,
                    created_by='system'
                )
                db.session.add(user)
                print(f"Created default admin: {admin['username']}")
            else:
                print(f"Admin {admin['username']} already exists, skipping...")
        db.session.commit()

def get_private_ip():
    try:
        # Get all addresses associated with the host
        hostname = socket.gethostname()
        addresses = socket.getaddrinfo(hostname, None)
        for addr in addresses:
            family, _, _, _, sockaddr = addr
            if family == socket.AF_INET:
                ip = sockaddr[0]
                # Skip loopback
                if isinstance(ip, str) and not ip.startswith("127."):
                    return ip
        # Fallback: try to gethostbyname
        ip = socket.gethostbyname(hostname)
        if isinstance(ip, str) and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "Unavailable"

def get_localhost_ip():
    return "127.0.0.1"

def find_available_port(start_port=5000, max_attempts=10):
    """Find an available port starting from start_port"""
    import socket
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return port
        except OSError:
            continue
    return start_port  # Fallback to original port

# Find available port
port = find_available_port(5000)

# Print both
print(f"LANChatShare server running at:")
print(f"  → Private IP:   http://{get_private_ip()}:{port}")
print(f"  → Localhost IP: http://{get_localhost_ip()}:{port}")

socketio.run(app, host='0.0.0.0', port=port, debug=True)
