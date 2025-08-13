# LAN Chat & File Sharing App

## Setup

1. **Install dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```

2. **Run the app:**
   ```powershell
   python app.py
   ```

3. **Access from LAN:**
   - Open browser on any device in the same LAN.
   - Go to: `http://<host-ip>:5000/` (host IP is shown in the terminal and login page)

## Features
- Real-time chat (public, private, group)
- File sharing (PDF, images, videos, docs, etc.)
- Online users panel
- Message history
- Responsive UI (Bootstrap 5)

## File Storage
- All uploaded files are saved in `static/uploads/`

## Database
- SQLite file: `chat.db` (auto-created)

---

**Note:**
- No password required, just username.
- All data stays on your LAN, no internet needed.
