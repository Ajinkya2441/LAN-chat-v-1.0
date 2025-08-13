let socket = io();
let currentRecipients = null;
let groupUsers = [];

// Store drafts per chat
let chatDrafts = {};

function scrollChatToBottom() {
  let chatBody = document.getElementById('chat-body');
  chatBody.scrollTop = chatBody.scrollHeight;
}

// Helper to format UTC timestamp to local time string
function formatLocalTime(utcString) {
  if (!utcString) return '';
  const date = new Date(utcString);
  return date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderMessage(msg, isLatest = false) {
  let fileHtml = '';
  if (msg.file) {
    if (msg.file.mimetype.startsWith('image/')) {
      fileHtml = `<div><img src="/uploads/${msg.file.filename}" style="max-width:200px;" class="img-thumbnail"></div>`;
    } else if (msg.file.mimetype.startsWith('video/')) {
      fileHtml = `<div><video controls style="max-width:200px;"><source src="/uploads/${msg.file.filename}" type="${msg.file.mimetype}"></video></div>`;
    } else if (msg.file.mimetype.startsWith('audio/')) {
      fileHtml = `<div><audio controls style='max-width:200px;'><source src="/uploads/${msg.file.filename}" type="${msg.file.mimetype}"></audio></div>`;
    } else {
      fileHtml = `<div><a href="/uploads/${msg.file.filename}" target="_blank">${msg.file.original_name}</a></div>`;
    }
  }
  let msgClass = '';
  let deleteBtn = '';
  // Show delete button for all messages (own and friend's)
  deleteBtn = `<button class='btn btn-link text-danger btn-sm delete-msg-btn' data-msg-id='${msg.id}' title='Delete'><i class='bi bi-trash'></i></button>`;
  // Reply button
  let replyBtn = `<button class='btn btn-link text-primary btn-sm reply-msg-btn' data-msg-id='${msg.id}' title='Reply'><i class='bi bi-reply'></i></button>`;
  // React button
  let reactBtn = `<button class='btn btn-link text-warning btn-sm react-msg-btn' data-msg-id='${msg.id}' title='React'><i class='bi bi-emoji-smile'></i></button>`;
  let ticks = '';
  if (msg.sender === USERNAME) {
    msgClass = 'mine';
    // WhatsApp-like ticks
    if (msg.status === 'read') {
      ticks = `<span class='msg-ticks'><i class='bi bi-check2-all' style='color:#2196f3;font-size:1.2em;'></i></span>`;
    } else {
      ticks = `<span class='msg-ticks'><i class='bi bi-check2' style='color:#222;font-size:1.2em;'></i></span>`;
    }
  } else if (
    (currentRecipients === msg.sender) ||
    (currentRecipients === msg.recipients) ||
    (msg.recipients.split(',').includes(USERNAME) && currentRecipients)
  ) {
    msgClass = 'theirs';
    // Mark as read if not already
    if (msg.status !== 'read') {
      socket.emit('message_read', {msg_id: msg.id});
    }
  }
  if (isLatest) msgClass += ' latest';
  // Show reply preview if this is a reply
  let replyHtml = '';
  if (msg.reply_to) {
    let r = msg.reply_to;
    replyHtml = `<div class='reply-preview border rounded p-1 mb-1' style='background:#f1f1f1;font-size:0.95em;'><b>${r.sender}:</b> ${r.content}</div>`;
  }
  // Show reactions
  let reactionsHtml = '';
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    reactionsHtml = `<div class='reactions-bar mt-1'>`;
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      let reacted = users.includes(USERNAME) ? 'reacted' : '';
      reactionsHtml += `<span class='reaction ${reacted}' data-msg-id='${msg.id}' data-emoji='${emoji}' title='${users.join(', ')}'>${emoji} <span class='reaction-count'>${users.length}</span></span> `;
    }
    reactionsHtml += `</div>`;
  }
  let html = `<div class="message-wrapper">
    <div class="message ${msgClass}" data-msg-id="${msg.id}">
      <div class="msg-header-row">
        <span class="sender">${msg.sender}</span>
        <span class="msg-actions">${replyBtn}${reactBtn}${deleteBtn}</span>
      </div>
      ${replyHtml}
      <div class="msg-content">${msg.content || ''}</div>
      ${fileHtml}
      ${reactionsHtml}
      ${ticks}
    </div>
    <span class="timestamp${isLatest ? ' always' : ''}">${formatLocalTime(msg.timestamp)}</span>
  </div>`;
  $('#chat-body').append(html);
  scrollChatToBottom();
}

function loadHistory(filter) {
  $('#chat-body').html('<div class="text-center text-muted">Loading...</div>');
  $.get('/history', {user: filter}, function(data) {
    $('#chat-body').empty();
    data.forEach(function(msg, idx) {
      renderMessage(msg, idx === data.length - 1);
    });
  });
}

// Remove updateUserList(users) and instead use only /users_status as the source of truth
function updateUserListFromStatus(statusList) {
  let ul = $('#user-list');
  ul.empty();
  statusList.forEach(u => {
    if (u.username === USERNAME) return; // Skip current user
    let badge = `<span class="badge bg-danger ms-auto" id="badge-${u.username}" style="display:none;">0</span>`;
    let statusClass = u.online ? 'status-online' : 'status-offline';
    let dot = `<span class="status-dot ${statusClass}"></span>`;
    let li = $(`<li class="list-group-item user-item d-flex align-items-center justify-content-between" data-user="${u.username}">${dot}<span class="ms-2">${u.username}</span>${badge}</li>`);
    ul.append(li);
  });
  let groupSel = $('#group-users');
  groupSel.empty();
  statusList.forEach(u => {
    if (u.username !== USERNAME) groupSel.append(`<option value="${u.username}">${u.username}</option>`);
  });
  syncMobileSidebar(); // <-- Ensure mobile sidebar is updated
}

// Notification badge logic
function showBadge(user) {
  if (user !== USERNAME) {
    let badge = $(`#badge-${user}`);
    let count = parseInt(badge.attr('data-count')) || 0;
    count++;
    badge.attr('data-count', count);
    badge.text(count === 1 ? 'NEW' : count);
    badge.show();
    syncMobileSidebar(); // Ensure mobile sidebar badge is updated
    updateChatTabBadge(); // Update chat tab badge
  }
}
function clearBadge(user) {
  let badge = $(`#badge-${user}`);
  badge.attr('data-count', 0);
  badge.text('');
  badge.hide();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}

// Show badge for group
function showGroupBadge(groupId) {
  let badge = $(`#group-list .group-item[data-group-id='${groupId}'] .group-badge`);
  let count = parseInt(badge.attr('data-count')) || 0;
  count++;
  badge.attr('data-count', count);
  badge.text(count === 1 ? 'NEW' : count);
  badge.show();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}
// Clear badge for group
function clearGroupBadge(groupId) {
  let badge = $(`#group-list .group-item[data-group-id='${groupId}'] .group-badge`);
  badge.attr('data-count', 0);
  badge.text('');
  badge.hide();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}

// Typing indicator logic
let typingTimeout;
let lastTypedRecipient = null;
$('#message-input').on('input', function() {
  if (!currentRecipients) return;
  if (lastTypedRecipient !== currentRecipients) {
    lastTypedRecipient = currentRecipients;
  }
  socket.emit('typing', {to: currentRecipients});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(function() {
    socket.emit('stop_typing', {to: currentRecipients});
  }, 1500);
});

socket.on('show_typing', function(data) {
  if (currentRecipients === data.from || currentRecipients === data.room) {
    if ($('#typing-indicator').length === 0) {
      $('#chat-body').append('<div id="typing-indicator" class="text-muted" style="margin:8px 0 0 8px;">Typing...</div>');
      scrollChatToBottom();
    }
  }
});
socket.on('hide_typing', function(data) {
  $('#typing-indicator').remove();
});

$(function() {
  socket.emit('join', {room: USERNAME});
  $('#chat-body').html('<div class="text-center text-muted">Select a user or group to start chatting.</div>');
  // Use /users_status for initial user list
  $.get('/users_status', updateUserListFromStatus);

  // Listen for user_list and refresh from /users_status
  socket.on('user_list', function() {
    $.get('/users_status', updateUserListFromStatus);
  });

  socket.on('receive_message', function(msg) {
    // If the message is for the current open chat, render it
    if (
      (currentRecipients === msg.sender && msg.recipients === USERNAME) ||
      (currentRecipients === msg.recipients && msg.sender === USERNAME) ||
      (msg.recipients.split(',').includes(USERNAME) && currentRecipients === msg.sender) ||
      // Fix: show group message in real time if viewing that group
      (currentRecipients && currentRecipients.startsWith('group-') && currentRecipients === msg.recipients)
    ) {
      renderMessage(msg);
    }
    // Show badge if the message is for this user, from another user, and not currently open chat
    if (
      msg.recipients.split(',').includes(USERNAME) &&
      msg.sender !== USERNAME &&
      currentRecipients !== msg.sender
    ) {
      showBadge(msg.sender);
    }
    // Show group badge if group message and not currently open
    if (
      msg.recipients.startsWith('group-') &&
      msg.sender !== USERNAME &&
      currentRecipients !== msg.recipients
    ) {
      // Extract group id
      let groupId = msg.recipients.split('-')[1];
      showGroupBadge(groupId);
    }
    // Show notification if message is for this user and not from self, and window is not focused
    if (
      msg.recipients.split(',').includes(USERNAME) &&
      msg.sender !== USERNAME &&
      !document.hasFocus()
    ) {
      console.log('Attempting to show notification:', msg);
      showBrowserNotification(msg);
    }
    // --- In-app notification for mobile ---
    if (
      isMobileView() &&
      msg.sender !== USERNAME &&
      (
        // For user chat: not currently open
        (msg.recipients.split(',').includes(USERNAME) && currentRecipients !== msg.sender) ||
        // For group chat: not currently open
        (msg.recipients.startsWith('group-') && currentRecipients !== msg.recipients)
      )
    ) {
      showInAppNotification(msg);
    }
  });

  socket.on('message_read', function(data) {
    const msgId = data.msg_id;
    // Update all matching ticks in the DOM, even if chat is not open
    $(".message[data-msg-id='" + msgId + "'] .msg-ticks").html("<i class='bi bi-check2-all' style='color:#2196f3;font-size:1.2em;'></i>");
  });

  function saveCurrentDraft() {
    if (currentRecipients) {
      chatDrafts[currentRecipients] = {
        text: $('#message-input').val(),
        file: $('#file-input')[0].files[0] || null
      };
    }
  }

  function restoreDraftFor(recipient) {
    const draft = chatDrafts[recipient] || {text: '', file: null};
    $('#message-input').val(draft.text || '');
    // Restore file input and preview
    if (draft.file) {
      // Create a DataTransfer to set the file input (works in modern browsers)
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(draft.file);
      $('#file-input')[0].files = dataTransfer.files;
      $('#file-name').text(draft.file.name);
      let preview = '';
      if (draft.file.type.startsWith('image/')) {
        const url = URL.createObjectURL(draft.file);
        preview = `<img src='${url}' style='max-width:40px;max-height:40px;border-radius:6px;margin-left:4px;'>`;
      } else if (draft.file.type.startsWith('video/')) {
        preview = `<i class='bi bi-film' style='font-size:1.3em;margin-left:4px;'></i>`;
      } else if (draft.file.type.includes('pdf')) {
        preview = `<i class='bi bi-file-earmark-pdf' style='font-size:1.3em;margin-left:4px;color:#d32f2f;'></i>`;
      } else if (draft.file.type.includes('zip') || draft.file.type.includes('rar') || draft.file.type.includes('7z')) {
        preview = `<i class='bi bi-file-earmark-zip' style='font-size:1.3em;margin-left:4px;color:#f0ad4e;'></i>`;
      } else if (draft.file.type.startsWith('audio/')) {
        preview = `<i class='bi bi-music-note-beamed' style='font-size:1.3em;margin-left:4px;color:#007bff;'></i>`;
      } else {
        preview = `<i class='bi bi-file-earmark' style='font-size:1.3em;margin-left:4px;'></i>`;
      }
      preview += ` <button type='button' id='cancel-file-btn' class='btn btn-sm btn-outline-danger ms-2' title='Cancel'><i class='bi bi-x'></i></button>`;
      $('#file-preview').html(preview);
    } else {
      // Clear file input and preview
      $('#file-input').val('');
      $('#file-name').text('No file');
      $('#file-preview').html('');
    }
  }

  $('#user-list').on('click', '.user-item', function() {
    saveCurrentDraft();
    // Remove 'active' from all user and group items
    $('#user-list .user-item, #group-list .group-item').removeClass('active animated-select');
    $(this).addClass('active animated-select');
    let user = $(this).data('user');
    if (user === USERNAME) return;
    // Save the current draft before switching
    if (currentRecipients) saveCurrentDraft();
    currentRecipients = user;
    groupUsers = [];
    $('#chat-title').text('Chat with ' + user);
    loadHistory(user);
    clearBadge(user);
    restoreDraftFor(user);
  });

  $('#start-group').click(function() {
    saveCurrentDraft();
    groupUsers = $('#group-users').val() || [];
    if (groupUsers.length > 0) {
      groupUsers.push(USERNAME);
      groupUsers = [...new Set(groupUsers)].sort();
      let groupRoom = 'group-' + groupUsers.join('-');
      currentRecipients = groupRoom;
      socket.emit('join', {room: groupRoom});
      $('#chat-title').text('Group: ' + groupUsers.filter(u => u !== USERNAME).join(', '));
      loadHistory(groupRoom);
      restoreDraftFor(groupRoom);
    }
  });

  $('#show-history').click(function() {
    loadHistory(USERNAME);
  });

  // Remove ALL previous submit handlers and only use ONE
  $('#message-form').off('submit');
  // Only keep this single handler:
  $('#message-form').on('submit', function(e) {
    e.preventDefault();
    let content = $('#message-input').val();
    let file = $('#file-input')[0].files[0];
    // Prevent sending if all are empty (text, file, audio)
    if (!content && !file && !audioBlob) return;
    let data = {
      recipients: currentRecipients,
      content: content
    };
    if (replyToMsgId) data.reply_to = replyToMsgId;
    if (file) {
      let formData = new FormData();
      formData.append('file', file);
      $('#file-name').text('Uploading...');
      $('#message-form button[type="submit"]').prop('disabled', true);
      $.ajax({
        url: '/upload',
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false,
        success: function(resp) {
          if (resp.file_id) {
            data.file_id = resp.file_id;
            socket.emit('send_message', data);
          } else {
            showPopup({
              title: 'Upload Failed',
              message: 'File upload failed.',
              icon: 'error'
            });
          }
        },
        error: function(xhr) {
          showPopup({
            title: 'Upload Failed',
            message: 'File upload failed: ' + (xhr.responseJSON?.error || 'Unknown error'),
            icon: 'error'
          });
        },
        complete: function() {
          $('#file-input').val('');
          $('#file-name').text('No file');
          $('#file-preview').html('');
          $('#message-input').val('');
          replyToMsgId = null;
          $('#reply-preview-bar').remove();
          $('#message-form button[type="submit"]').prop('disabled', false);
        }
      });
    } else if (audioBlob) {
      let formData = new FormData();
      formData.append('file', audioBlob, 'audio_message.webm');
      $('#audio-record-status').text('Uploading...');
      $.ajax({
        url: '/upload',
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false,
        success: function(resp) {
          if (resp.file_id) {
            data.file_id = resp.file_id;
            socket.emit('send_message', data);
          } else {
            showPopup({
              title: 'Audio Upload Failed',
              message: 'Audio upload failed.',
              icon: 'error'
            });
          }
        },
        error: function(xhr) {
          showPopup({
            title: 'Audio Upload Failed',
            message: 'Audio upload failed: ' + (xhr.responseJSON?.error || 'Unknown error'),
            icon: 'error'
          });
        },
        complete: function() {
          audioBlob = null;
          $('#audio-preview').hide().attr('src', '');
          $('#audio-record-status').hide();
          $('#cancel-audio-btn').remove();
          $('#message-input').val('');
          replyToMsgId = null;
          $('#reply-preview-bar').remove();
        }
      });
    } else {
      socket.emit('send_message', data);
      $('#message-input').val('');
      $('#file-input').val('');
      $('#file-name').text('No file');
      $('#file-preview').html('');
      replyToMsgId = null;
      $('#reply-preview-bar').remove();
    }
    if (currentRecipients) chatDrafts[currentRecipients] = {text: '', file: null};
  });

  // Delete message handler
  $(document).on('click', '.delete-msg-btn', function() {
    showPopup({
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message?',
      icon: 'warning',
      okText: 'Delete',
      cancelText: 'Cancel',
      showCancel: true,
      onOk: function() {
        let msgId = $(this).data('msg-id');
        let msgDiv = $(this).closest('.message');
        $.post(`/delete_message/${msgId}`, function(resp) {
          if (resp.success) {
            msgDiv.remove();
          } else {
            showPopup({
              title: 'Delete Failed',
              message: resp.error || 'Delete failed',
              icon: 'error'
            });
          }
        });
      }.bind(this)
    });
  });

  $('#file-input').on('change', function() {
    const file = this.files[0];
    const fileName = file ? file.name : 'No file';
    $('#file-name').text(fileName);
    let preview = '';
    if (file) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        preview = `<img src='${url}' style='max-width:80px;max-height:80px;border-radius:8px;margin-left:4px;'>`;
      } else if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        preview = `<video controls style='max-width:120px;max-height:80px;margin-left:4px;'><source src='${url}' type='${file.type}'></video>`;
      } else if (file.type.startsWith('audio/')) {
        const url = URL.createObjectURL(file);
        preview = `<audio controls style='max-width:120px;margin-left:4px;'><source src='${url}' type='${file.type}'></audio>`;
      } else if (file.type.includes('pdf')) {
        preview = `<i class='bi bi-file-earmark-pdf' style='font-size:2em;margin-left:4px;color:#d32f2f;'></i>`;
      } else if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('7z')) {
        preview = `<i class='bi bi-file-earmark-zip' style='font-size:2em;margin-left:4px;color:#f0ad4e;'></i>`;
      } else {
        preview = `<i class='bi bi-file-earmark' style='font-size:2em;margin-left:4px;'></i>`;
      }
      // Add cancel button
      preview += ` <button type='button' id='cancel-file-btn' class='btn btn-sm btn-outline-danger ms-2' title='Cancel'><i class='bi bi-x'></i></button>`;
    }
    $('#file-preview').html(preview);
  });

  // Cancel file selection
  $(document).on('click', '#cancel-file-btn', function() {
    // Replace file input with a fresh clone to ensure change event always fires
    const $oldInput = $('#file-input');
    const $newInput = $oldInput.clone().val('');
    $oldInput.replaceWith($newInput);
    $newInput.on('change', function() {
      const file = this.files[0];
      const fileName = file ? file.name : 'No file';
      $('#file-name').text(fileName);
      let preview = '';
      if (file) {
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          preview = `<img src='${url}' style='max-width:40px;max-height:40px;border-radius:6px;margin-left:4px;'>`;
        } else if (file.type.startsWith('video/')) {
          preview = `<i class='bi bi-film' style='font-size:1.3em;margin-left:4px;'></i>`;
        } else if (file.type.includes('pdf')) {
          preview = `<i class='bi bi-file-earmark-pdf' style='font-size:1.3em;margin-left:4px;color:#d32f2f;'></i>`;
        } else if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('7z')) {
          preview = `<i class='bi bi-file-earmark-zip' style='font-size:1.3em;margin-left:4px;color:#f0ad4e;'></i>`;
        } else if (file.type.startsWith('audio/')) {
          preview = `<i class='bi bi-music-note-beamed' style='font-size:1.3em;margin-left:4px;color:#007bff;'></i>`;
        } else {
          preview = `<i class='bi bi-file-earmark' style='font-size:1.3em;margin-left:4px;'></i>`;
        }
        preview += ` <button type='button' id='cancel-file-btn' class='btn btn-sm btn-outline-danger ms-2' title='Cancel'><i class='bi bi-x'></i></button>`;
      }
      $('#file-preview').html(preview);
    });
    $('#file-name').text('No file');
    $('#file-preview').html('');
    // Remove file from draft if using per-chat drafts
    if (currentRecipients && chatDrafts) {
      chatDrafts[currentRecipients] = chatDrafts[currentRecipients] || {text: '', file: null};
      chatDrafts[currentRecipients].file = null;
    }
  });

  $('#message-input').on('input', function() {
    // Save text draft for current chat
    if (currentRecipients) {
      chatDrafts[currentRecipients] = chatDrafts[currentRecipients] || {text: '', file: null};
      chatDrafts[currentRecipients].text = $(this).val();
    }
  });
});

// Enhance Enter key behavior: if file is selected, pressing Enter sends the file (and message if present)
$('#message-input').off('keydown').on('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#message-form').submit();
  }
});

// Request notification permission on page load
if (window.Notification && Notification.permission !== 'granted') {
  Notification.requestPermission();
}

function showBrowserNotification(msg) {
  if (window.Notification && Notification.permission === 'granted') {
    let body = msg.content ? msg.content : (msg.file ? 'Sent a file' : '');
    let notification = new Notification('New message from ' + msg.sender, {
      body: body,
      icon: '/static/icons/favicon.ico' // Optional: set your favicon or chat icon
    });
    notification.onclick = function() {
      window.focus();
      this.close();
    };
  }
}

// --- Reply and React Handlers ---
let replyToMsgId = null;

// Reply button click
$(document).on('click', '.reply-msg-btn', function() {
  const msgId = $(this).data('msg-id');
  const msgDiv = $(this).closest('.message');
  const msgSender = msgDiv.find('.sender').text();
  const msgContent = msgDiv.find('.msg-content').text();
  replyToMsgId = msgId;
  // Show reply preview above input
  if ($('#reply-preview-bar').length === 0) {
    $('#message-form').prepend(`<div id='reply-preview-bar' class='alert alert-secondary py-1 px-2 mb-2 d-flex align-items-center justify-content-between'>
      <span><b>Replying to ${msgSender}:</b> ${msgContent}</span>
      <button type='button' class='btn btn-sm btn-outline-danger ms-2' id='cancel-reply-btn'><i class='bi bi-x'></i></button>
    </div>`);
  } else {
    $('#reply-preview-bar span').html(`<b>Replying to ${msgSender}:</b> ${msgContent}`);
  }
});
// Cancel reply
$(document).on('click', '#cancel-reply-btn', function() {
  replyToMsgId = null;
  $('#reply-preview-bar').remove();
});

// React button click (show emoji picker)
$(document).on('click', '.react-msg-btn', function(e) {
  e.stopPropagation();
  const msgId = $(this).data('msg-id');
  // Simple emoji picker (customize as needed)
  const emojis = ['👍','😂','❤️','😮','😢','🙏'];
  let picker = `<div class='emoji-picker border rounded bg-white p-2' style='position:absolute;z-index:10;'>`;
  emojis.forEach(emoji => {
    picker += `<span class='emoji-option' data-msg-id='${msgId}' data-emoji='${emoji}' style='font-size:1.5em;cursor:pointer;margin:0 4px;'>${emoji}</span>`;
  });
  picker += `</div>`;
  // Remove any existing picker
  $('.emoji-picker').remove();
  $(this).parent().append(picker);
});
// Click emoji to react
$(document).on('click', '.emoji-option', function(e) {
  e.stopPropagation();
  const msgId = $(this).data('msg-id');
  const emoji = $(this).data('emoji');
  socket.emit('react_message', {msg_id: msgId, emoji: emoji});
  $('.emoji-picker').remove();
});
// Remove reaction on click (if already reacted)
$(document).on('click', '.reaction.reacted', function(e) {
  e.stopPropagation();
  const msgId = $(this).data('msg-id');
  const emoji = $(this).data('emoji');
  socket.emit('remove_reaction', {msg_id: msgId, emoji: emoji});
});
// Hide emoji picker on outside click
$(document).on('click', function(e) {
  if (!$(e.target).closest('.emoji-picker, .react-msg-btn').length) {
    $('.emoji-picker').remove();
  }
});
// --- END Reply and React Handlers ---

// Update reactions in real time
socket.on('update_reactions', function(data) {
  const msgId = data.msg_id;
  const reactions = data.reactions;
  const msgDiv = $(`.message[data-msg-id='${msgId}']`);
  let reactionsHtml = '';
  if (reactions && Object.keys(reactions).length > 0) {
    reactionsHtml = `<div class='reactions-bar mt-1'>`;
    for (const [emoji, users] of Object.entries(reactions)) {
      let reacted = users.includes(USERNAME) ? 'reacted' : '';
      reactionsHtml += `<span class='reaction ${reacted}' data-msg-id='${msgId}' data-emoji='${emoji}' title='${users.join(', ')}'>${emoji} <span class='reaction-count'>${users.length}</span></span> `;
    }
    reactionsHtml += `</div>`;
  }
  msgDiv.find('.reactions-bar').remove();
  if (reactionsHtml) msgDiv.append(reactionsHtml);
});

// --- Audio Recording ---
let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;

$(document).on('click', '#audio-record-btn', function() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    $('#audio-record-status').text('Processing...').show();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = function(e) {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = function() {
      audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(audioBlob);
      $('#audio-preview').attr('src', url).show();
      $('#audio-record-status').text('Audio ready!').show();
      // Show cancel button
      if ($('#cancel-audio-btn').length === 0) {
        $('#audio-record-area').append(`<button type='button' id='cancel-audio-btn' class='btn btn-sm btn-outline-danger ms-2' title='Cancel'><i class='bi bi-x'></i></button>`);
      }
    };
    mediaRecorder.start();
    $('#audio-record-status').text('Recording...').show();
    $('#audio-preview').hide();
    audioBlob = null;
    $('#cancel-audio-btn').remove();
  }).catch(function(err) {
    showPopup({
      title: 'Microphone Access Denied',
      message: 'Microphone access denied or not available.',
      icon: 'error'
    });
  });
});
// Cancel audio
$(document).on('click', '#cancel-audio-btn', function() {
  audioBlob = null;
  $('#audio-preview').hide().attr('src', '');
  $('#audio-record-status').hide();
  $(this).remove();
});

// --- WhatsApp-like Group Chat Frontend Logic ---
$(document).ready(function() {
  // Load group list
  function loadGroups() {
    $.get('/groups', function(groups) {
      let $list = $('#group-list');
      $list.empty();
      if (!groups.length) {
        $list.append('<li class="list-group-item text-muted">No groups yet</li>');
      } else {
        groups.forEach(function(g) {
          let icon = g.icon ? `<img src='${g.icon}' style='width:28px;height:28px;border-radius:50%;margin-right:8px;'>` : `<i class='bi bi-people-fill' style='font-size:1.3em;margin-right:8px;'></i>`;
          // Add a badge for new messages
          let badge = `<span class='badge bg-danger ms-auto group-badge' style='display:none;' data-count='0'></span>`;
          $list.append(`<li class="list-group-item group-item d-flex align-items-center justify-content-between" data-group-id="${g.id}">${icon}<span>${g.name}</span>${badge}</li>`);
        });
      }
      syncMobileSidebar(); // <-- Ensure mobile sidebar is updated after groups load
    });
  }
  loadGroups();

  // Open create group modal
  $('#open-create-group-modal').click(function() {
    // Load user list for member selection with checkboxes
    $.get('/users_status', function(users) {
      let $list = $('#group-members-list');
      $list.empty();
      users.forEach(function(u) {
        if (u.username === USERNAME) return;
        $list.append(`
          <div class="list-group-item d-flex align-items-center justify-content-between">
            <div>
              <input type="checkbox" class="form-check-input group-member-checkbox" value="${u.username}" id="member-${u.username}">
              <label for="member-${u.username}" class="form-check-label ms-2">${u.username}</label>
            </div>
            <div>
              <input type="checkbox" class="form-check-input group-admin-checkbox" value="${u.username}" id="admin-${u.username}">
              <label for="admin-${u.username}" class="form-check-label ms-1 text-primary">Admin</label>
            </div>
          </div>
        `);
      });
    });
    $('#createGroupModal').modal('show');
  });

  // Handle group creation
  $('#create-group-form').submit(function(e) {
    e.preventDefault();
    let name = $('#group-name').val().trim();
    let description = $('#group-description').val().trim();
    let icon = $('#group-icon').val().trim();
    let members = [];
    let admins = [USERNAME]; // Always include self as admin
    $('.group-member-checkbox:checked').each(function() {
      members.push($(this).val());
    });
    members.push(USERNAME); // Always include self as member
    members = [...new Set(members)];
    $('.group-admin-checkbox:checked').each(function() {
      admins.push($(this).val());
    });
    admins = [...new Set(admins)];
    if (!name) {
      showPopup({
        title: 'Group Name Required',
        message: 'Please enter a group name.',
        icon: 'warning'
      });
      return;
    }
    if (members.length < 2) {
      showPopup({
        title: 'Select Members',
        message: 'Select at least one member for the group.',
        icon: 'warning'
      });
      return;
    }
    $.ajax({
      url: '/groups/', // <-- Add trailing slash to avoid 301 redirect
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ name: name, description: description, members: members, admins: admins, icon: icon }),
      success: function(resp) {
        if (resp.success) {
          $('#createGroupModal').modal('hide');
          // Clear form fields
          $('#group-name').val('');
          $('#group-description').val('');
          $('#group-icon').val('');
          $('.group-member-checkbox').prop('checked', false);
          $('.group-admin-checkbox').prop('checked', false);
          loadGroups();
        } else {
          showPopup({
            title: 'Update Failed',
            message: resp.error || 'Group creation failed',
            icon: 'error'
          });
        }
      },
      error: function(xhr) {
        showPopup({
          title: 'Update Failed',
          message: xhr.responseJSON?.error || 'Group creation failed',
          icon: 'error'
        });
        console.error('Group creation error:', xhr);
      }
    });
  });

  // Click group to open chat
  $(document).on('click', '.group-item', function() {
    // Remove 'active' from all user and group items
    $('#user-list .user-item, #group-list .group-item').removeClass('active animated-select');
    $(this).addClass('active animated-select');
    let groupId = $(this).data('group-id');
    currentRecipients = 'group-' + groupId;
    currentGroupId = groupId;
    socket.emit('join', {room: 'group-' + groupId}); // Join group room for real-time
    $('#chat-title').text('Group: ' + $(this).find('span').text());
    // Load group messages (reuse loadHistory but pass groupId)
    loadGroupHistory(groupId);
    updateGroupInfoBtn();
    // Clear group badge when group is opened
    clearGroupBadge(groupId);
  });

  // Mobile: open user chat
  $('#mobile-user-list').on('click', '.user-item', function() {
    // Hide mobile sidebar and show chat area immediately
    $('#mobileSidebarPanel').hide();
    $('.chat-col').addClass('active');
    // Remove active state from nav buttons
    $('#tabChats, #tabGroups').removeClass('active');
    let user = $(this).data('user');
    if (user === USERNAME) return;
    currentRecipients = user;
    groupUsers = [];
    $('#chat-title').text('Chat with ' + user);
    loadHistory(user);
    clearBadge(user);
    restoreDraftFor(user);
  });

  // Mobile: open group chat
  $('#mobile-group-list').on('click', '.group-item', function() {
    // Hide mobile sidebar and show chat area immediately
    $('#mobileSidebarPanel').hide();
    $('.chat-col').addClass('active');
    // Remove active state from nav buttons
    $('#tabChats, #tabGroups').removeClass('active');
    let groupId = $(this).data('group-id');
    currentRecipients = 'group-' + groupId;
    currentGroupId = groupId;
    socket.emit('join', {room: 'group-' + groupId});
    $('#chat-title').text('Group: ' + $(this).find('span').text());
    loadGroupHistory(groupId);
    updateGroupInfoBtn();
    clearGroupBadge(groupId);
  });

  // Load group chat history
  function loadGroupHistory(groupId) {
    $('#chat-body').html('<div class="text-center text-muted">Loading group chat...</div>');
    $.get('/history', { group_id: groupId }, function(data) {
      $('#chat-body').empty();
      data.forEach(function(msg, idx) {
        renderMessage(msg, idx === data.length - 1);
      });
    });
  }

  // Delegated event handler for mobile new group button
  $(document).on('click', '#mobile-new-group-btn', function(e) {
    e.preventDefault();
    console.log('[DEBUG] #mobile-new-group-btn clicked');
    // Check if modal exists
    if ($('#createGroupModal').length === 0) {
      console.error('[ERROR] #createGroupModal not found in DOM');
      showPopup({
        title: 'Error',
        message: 'Group modal not found.',
        icon: 'error'
      });
      return;
    }
    // Check if Bootstrap modal method is available
    if (typeof $('#createGroupModal').modal !== 'function') {
      console.error('[ERROR] Bootstrap modal() function not available');
      showPopup({
        title: 'Error',
        message: 'Bootstrap modal JS not loaded.',
        icon: 'error'
      });
      return;
    }
    // Try to trigger the desktop button (in case logic is there)
    const $desktopBtn = $('#open-create-group-modal');
    if ($desktopBtn.length) {
      $desktopBtn.trigger('click');
      // Also show modal directly as fallback (in case event is missed)
      setTimeout(function() {
        if (!$('#createGroupModal').hasClass('show')) {
          try {
            $('#createGroupModal').modal('show');
          } catch (err) {
            console.error('[ERROR] Failed to show modal:', err);
            showPopup({
              title: 'Error',
              message: 'Failed to open group modal. See console for details.',
              icon: 'error'
            });
          }
        }
      }, 100);
    } else {
      // Fallback: show modal directly
      try {
        $('#createGroupModal').modal('show');
      } catch (err) {
        console.error('[ERROR] Failed to show modal:', err);
        showPopup({
          title: 'Error',
          message: 'Failed to open group modal. See console for details.',
          icon: 'error'
        });
      }
    }
  });
});
// --- END WhatsApp-like Group Chat Frontend Logic ---
// --- Group Info Modal Logic ---
let currentGroupId = null;

// Open group info modal
$('#group-info-btn').on('click', function() {
  if (!currentGroupId) return;
  $.get(`/groups/${currentGroupId}`, function(info) {
    // Icon, name, created, description
    if (info.icon) {
      $('#group-info-icon').attr('src', info.icon).show();
      $('#group-info-default-icon').hide();
    } else {
      $('#group-info-icon').hide();
      $('#group-info-default-icon').show();
    }
    $('#group-info-name').text(info.name);
    $('#group-info-created').text('Created by ' + info.created_by + ' on ' + info.created_at);
    $('#group-info-description').text(info.description || '');
    // Members view for all
    let membersHtml = '<ul class="list-group">';
    info.members.forEach(m => {
      let adminBadge = m.is_admin ? " <span class='badge bg-primary ms-1'>Admin</span>" : '';
      membersHtml += `<li class='list-group-item d-flex align-items-center justify-content-between'>${m.username}${adminBadge}</li>`;
    });
    membersHtml += '</ul>';
    $('#group-info-members-view').html(membersHtml);
    // If admin, show settings form
    if (info.is_admin) {
      $('#group-settings-form').show();
      // Populate editable fields
      $('#edit-group-name').val(info.name);
      $('#edit-group-description').val(info.description || '');
      // Load all users for member/admin management
      $.get('/users_status', function(users) {
        let $list = $('#group-settings-members-list');
        $list.empty();
        users.forEach(function(u) {
          let isMember = info.members.some(m => m.username === u.username);
          let isAdmin = info.members.some(m => m.username === u.username && m.is_admin);
          let disabled = u.username === info.created_by ? 'disabled' : '';
          $list.append(`
            <div class="list-group-item d-flex align-items-center justify-content-between">
              <div>
                <input type="checkbox" class="form-check-input group-settings-member-checkbox" value="${u.username}" id="settings-member-${u.username}" ${isMember ? 'checked' : ''} ${disabled}>
                <label for="settings-member-${u.username}" class="form-check-label ms-2">${u.username}</label>
              </div>
              <div>
                <input type="checkbox" class="form-check-input group-settings-admin-checkbox" value="${u.username}" id="settings-admin-${u.username}" ${isAdmin ? 'checked' : ''} ${disabled}>
                <label for="settings-admin-${u.username}" class="form-check-label ms-1 text-primary">Admin</label>
              </div>
            </div>
          `);
        });
      });
      // Admin-only toggle
      $('#admin-only-toggle').prop('checked', info.admin_only);
    } else {
      $('#group-settings-form').hide();
    }
    $('#groupInfoModal').modal('show');
  });
});

// Save group settings
$('#group-settings-form').on('submit', function(e) {
  e.preventDefault();
  let name = $('#edit-group-name').val().trim();
  let description = $('#edit-group-description').val().trim();
  let members = [];
  let admins = [];
  $('.group-settings-member-checkbox:checked').each(function() {
    members.push($(this).val());
  });
  $('.group-settings-admin-checkbox:checked').each(function() {
    admins.push($(this).val());
  });
  let admin_only = $('#admin-only-toggle').is(':checked');
  // Update group info with correct content type
  $.ajax({
    url: `/groups/${currentGroupId}/update`,
    type: 'POST',
    data: JSON.stringify({name: name, description: description}),
    contentType: 'application/json',
    dataType: 'json',
    success: function(resp) {
      // alert('Update group response: ' + JSON.stringify(resp)); // DEBUG
      if (!resp.success) return showPopup({
        title: 'Update Failed',
        message: resp.error || 'Failed to update group',
        icon: 'error'
      });
      // Update members/admins
      $.post(`/groups/${currentGroupId}/set_members_admins`, JSON.stringify({members: members, admins: admins}), function(resp2) {
        // alert('Set members/admins response: ' + JSON.stringify(resp2)); // DEBUG
        if (!resp2.success) return showPopup({
          title: 'Update Failed',
          message: resp2.error || 'Failed to update members/admins',
          icon: 'error'
        });
        // Update admin-only toggle
        $.post(`/groups/${currentGroupId}/admin_only`, JSON.stringify({admin_only: admin_only}), function(resp3) {
          // alert('Admin only response: ' + JSON.stringify(resp3)); // DEBUG
          if (!resp3.success) return showPopup({
            title: 'Update Failed',
            message: resp3.error || 'Failed to update admin-only setting',
            icon: 'error'
          });
          // Update group name in the group list instantly
          $(`#group-list .group-item[data-group-id='${currentGroupId}'] span`).text(name);
          // Update modal title and description instantly
          $('#group-info-name').text(name);
          $('#group-info-description').text(description);
          // Show a success message
          if ($('#group-settings-success').length === 0) {
            $('#group-settings-form').prepend('<div id="group-settings-success" class="alert alert-success py-1 mb-2">Group updated!</div>');
          } else {
            $('#group-settings-success').show().text('Group updated!');
          }
          setTimeout(function() { $('#group-settings-success').fadeOut(); }, 1500);
        }, 'json');
      }, 'json');
    }
  });
});
// Delete group
$('#delete-group-btn').on('click', function() {
  showPopup({
    title: 'Delete Group',
    message: 'Are you sure you want to delete this group? This cannot be undone.',
    icon: 'warning',
    okText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    onOk: function() {
      $.post(`/groups/${currentGroupId}/delete`, function(resp) {
        if (resp.success) {
          $('#groupInfoModal').modal('hide');
          loadGroups();
          $('#chat-title').text('Select a user or group to start chatting.');
          $('#chat-body').html('<div class="text-center text-muted">Select a user or group to start chatting.</div>');
          currentRecipients = null;
          updateGroupInfoBtn();
          // Now emit to server so all clients update
          socket.emit('group_deleted', { group_id: currentGroupId });
        } else {
          showPopup({
            title: 'Delete Failed',
            message: resp.error || 'Failed to delete group',
            icon: 'error'
          });
        }
      });
    }
  });
});

// Listen for group_deleted event and reload group list in real time
socket.on('group_deleted', function(data) {
  loadGroups();
  if (currentGroupId == data.group_id) {
    $('#groupInfoModal').modal('hide');
    $('#chat-title').text('Select a user or group to start chatting.');
    $('#chat-body').html('<div class="text-center text-muted">Select a user or group to start chatting.</div>');
    currentRecipients = null;
    updateGroupInfoBtn();
  }
});

// Mute group
$(document).on('click', '#mute-group-btn', function() {
  if (!currentGroupId) return;
  $.post(`/groups/${currentGroupId}/mute`, function(resp) {
    if (resp.success) {
      $('#mute-group-btn').hide();
      $('#unmute-group-btn').show();
    } else {
      showPopup({
        title: 'Mute Failed',
        message: resp.error || 'Failed to mute group',
        icon: 'error'
      });
    }
  });
});
// Unmute group
$(document).on('click', '#unmute-group-btn', function() {
  if (!currentGroupId) return;
  $.post(`/groups/${currentGroupId}/unmute`, function(resp) {
    if (resp.success) {
      $('#unmute-group-btn').hide();
      $('#mute-group-btn').show();
    } else {
      showPopup({
        title: 'Unmute Failed',
        message: resp.error || 'Failed to unmute group',
        icon: 'error'
      });
    }
  });
});
// Leave group
$(document).on('click', '#leave-group-btn', function() {
  showPopup({
    title: 'Leave Group',
    message: 'Are you sure you want to leave this group?',
    icon: 'warning',
    okText: 'Leave',
    cancelText: 'Cancel',
    showCancel: true,
    onOk: function() {
      $.post(`/groups/${currentGroupId}/leave`, function(resp) {
        if (resp.success) {
          $('#groupInfoModal').modal('hide');
          loadGroups();
          $('#chat-title').text('Select a user or group to start chatting.');
          $('#chat-body').html('<div class="text-center text-muted">Select a user or group to start chatting.</div>');
          currentRecipients = null;
          updateGroupInfoBtn();
        } else {
          showPopup({
            title: 'Leave Failed',
            message: resp.error || 'Failed to leave group',
            icon: 'error'
          });
        }
      });
    }
  });
});

function updateGroupInfoBtn() {
  if (currentRecipients && typeof currentRecipients === 'string' && currentRecipients.startsWith('group-')) {
    $('#group-info-btn').removeClass('d-none').show();
  } else {
    $('#group-info-btn').addClass('d-none').hide();
  }
}

// Always update group info button on chat switch
$(document).on('click', '.group-item', function() { updateGroupInfoBtn(); });
$('#user-list').on('click', '.user-item', function() { updateGroupInfoBtn(); });

// Handle error when non-admin tries to send message in admin-only group
socket.on('group_admin_only_error', function(data) {
  // Show error as a toast or alert (replace with a better UI as needed)
  let errMsg = data && data.error ? data.error : 'Only admins can send messages in this group.';
  // Remove any previous error
  $('#admin-only-error').remove();
  // Show error above the message input
  $("#message-form").prepend(`<div id='admin-only-error' class='alert alert-warning py-1 mb-2'>${errMsg}</div>`);
  setTimeout(function() { $('#admin-only-error').fadeOut(500, function() { $(this).remove(); }); }, 2500);
});

function syncMobileSidebar() {
  // Copy user list
  $('#mobile-user-list').html($('#user-list').html());
  // Copy group list
  $('#mobile-group-list').html($('#group-list').html());
  // Ensure .user-item class is present
  $('#mobile-user-list li').addClass('user-item');
  $('#mobile-group-list li').addClass('user-item');
  // Attach mobile new group button handler
  $('#mobile-new-group-btn').off('click').on('click', function() {
    $('#open-create-group-modal').trigger('click');
  });
}

// --- In-app notification for mobile ---
function isMobileView() {
  return window.innerWidth <= 768;
}

function showInAppNotification(msg) {
  // Remove any existing notification
  $('#in-app-notification').remove();
  let sender = msg.sender;
  let isGroup = msg.recipients && msg.recipients.startsWith('group-');
  let chatId = isGroup ? msg.recipients : sender;
  let chatName = isGroup ? ($(`#group-list .group-item[data-group-id='${msg.recipients.split('-')[1]}'] span`).text() || 'Group') : sender;
  let content = msg.content ? msg.content : (msg.file ? 'Sent a file' : 'New message');
  let html = `
    <div id="in-app-notification" style="position:fixed;left:0;right:0;bottom:70px;z-index:9999;display:flex;justify-content:center;">
      <div class="toast show align-items-center text-bg-primary border-0" role="alert" style="min-width:220px;max-width:90vw;box-shadow:0 2px 8px rgba(0,0,0,0.2);cursor:pointer;" data-chat-id="${chatId}" data-is-group="${isGroup}">
        <div class="d-flex">
          <div class="toast-body">
            <b>${chatName}:</b> ${content}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    </div>
  `;
  $('body').append(html);
  // Auto-hide after 5 seconds
  setTimeout(function() { $('#in-app-notification').fadeOut(300, function() { $(this).remove(); }); }, 5000);
}

// Click handler for in-app notification
$(document).on('click', '#in-app-notification', function(e) {
  let $toast = $(this).find('.toast');
  let chatId = $toast.data('chat-id');
  let isGroup = $toast.data('is-group');
  $('#in-app-notification').remove();
  if (isGroup) {
    // Open group chat
    let groupId = chatId.split('-')[1];
    currentRecipients = 'group-' + groupId;
    currentGroupId = groupId;
    socket.emit('join', {room: 'group-' + groupId});
    $('#chat-title').text('Group: ' + ($(`#group-list .group-item[data-group-id='${groupId}'] span`).text() || 'Group'));
    if (isMobileView()) {
      $('#mobileSidebarPanel').hide();
      $('.chat-col').addClass('active');
      $('#tabChats, #tabGroups').removeClass('active');
    }
    // Load group messages
    if (typeof loadGroupHistory === 'function') {
      loadGroupHistory(groupId);
    }
    clearGroupBadge(groupId);
    updateGroupInfoBtn();
  } else {
    // Open user chat
    if (chatId === USERNAME) return;
    currentRecipients = chatId;
    groupUsers = [];
    $('#chat-title').text('Chat with ' + chatId);
    if (isMobileView()) {
      $('#mobileSidebarPanel').hide();
      $('.chat-col').addClass('active');
      $('#tabChats, #tabGroups').removeClass('active');
    }
    loadHistory(chatId);
    clearBadge(chatId);
    restoreDraftFor(chatId);
  }
});

// Close button for in-app notification
$(document).on('click', '#in-app-notification .btn-close', function(e) {
  e.stopPropagation();
  $('#in-app-notification').remove();
});

// --- Chat tab badge for mobile bottom nav ---
function updateChatTabBadge() {
  // Check if any user or group badge is visible and has count > 0
  let hasUnread = false;
  $('#user-list .badge, #group-list .group-badge').each(function() {
    if ($(this).is(':visible') && parseInt($(this).attr('data-count')) > 0) {
      hasUnread = true;
      return false;
    }
  });
  if (hasUnread) {
    $('#chat-tab-badge').show();
  } else {
    $('#chat-tab-badge').hide();
  }
}

function updateBadge(badgeId, count) {
    const badge = $('#' + badgeId);
    if (count > 0) {
        badge.text(count).show();
    } else {
        badge.hide();
    }
}

// Example usage for chats and groups:
// updateBadge('chats-badge', unreadChatsCount);
// updateBadge('groups-badge', unreadGroupsCount);
// updateBadge('pending-requests-badge', pendingRequestsCount);
// updateBadge('reset-requests-badge', resetRequestsCount);

// Replace all direct badge.text(count) or badge.text('0') calls with updateBadge.
// For demonstration, you can call updateBadge with 0 to hide, or with a number to show.

// Call updateChatTabBadge after every badge update
function showBadge(user) {
  if (user !== USERNAME) {
    let badge = $(`#badge-${user}`);
    let count = parseInt(badge.attr('data-count')) || 0;
    count++;
    badge.attr('data-count', count);
    badge.text(count === 1 ? 'NEW' : count);
    badge.show();
    syncMobileSidebar(); // Ensure mobile sidebar badge is updated
    updateChatTabBadge(); // Update chat tab badge
  }
}
function clearBadge(user) {
  let badge = $(`#badge-${user}`);
  badge.attr('data-count', 0);
  badge.text('');
  badge.hide();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}
// Show badge for group
function showGroupBadge(groupId) {
  let badge = $(`#group-list .group-item[data-group-id='${groupId}'] .group-badge`);
  let count = parseInt(badge.attr('data-count')) || 0;
  count++;
  badge.attr('data-count', count);
  badge.text(count === 1 ? 'NEW' : count);
  badge.show();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}
// Clear badge for group
function clearGroupBadge(groupId) {
  let badge = $(`#group-list .group-item[data-group-id='${groupId}'] .group-badge`);
  badge.attr('data-count', 0);
  badge.text('');
  badge.hide();
  syncMobileSidebar(); // Ensure mobile sidebar badge is updated
  updateChatTabBadge(); // Update chat tab badge
}

// --- Theme Switcher Dropdown Logic ---
function applyTheme(theme) {
  document.body.classList.remove('dark-theme', 'blue-theme', 'green-theme');
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (theme === 'blue') {
    document.body.classList.add('blue-theme');
  } else if (theme === 'green') {
    document.body.classList.add('green-theme');
  }
  // Save to localStorage
  localStorage.setItem('theme', theme);
}

$(function() {
  // Theme toggle handler
  function setTheme(isDark) {
    if (isDark) {
      $('body').addClass('dark-theme');
      $('#theme-toggle-btn i').removeClass('bi-moon').addClass('bi-sun');
    } else {
      $('body').removeClass('dark-theme');
      $('#theme-toggle-btn i').removeClass('bi-sun').addClass('bi-moon');
    }
  }
  // On load, check localStorage
  const savedTheme = localStorage.getItem('theme');
  setTheme(savedTheme === 'dark');
  // Toggle on button click
  $('#theme-toggle-btn').on('click', function() {
    const isDark = !$('body').hasClass('dark-theme');
    setTheme(isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });

  // Theme switcher dropdown
  const themeSwitcher = document.getElementById('theme-switcher');
  if (themeSwitcher) {
    // On change
    themeSwitcher.addEventListener('change', function() {
      applyTheme(this.value);
    });
    // On load, set theme from localStorage
    let savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    themeSwitcher.value = savedTheme;
  }
});
// --- END Theme Switcher Dropdown Logic ---

// --- Info Button Logic ---
function updateInfoBtns() {
  if (currentRecipients && typeof currentRecipients === 'string') {
    if (currentRecipients.startsWith('group-')) {
      $('#group-info-btn').removeClass('d-none').show();
      $('#chat-info-btn').addClass('d-none').hide();
    } else {
      $('#chat-info-btn').removeClass('d-none').show();
      $('#group-info-btn').addClass('d-none').hide();
    }
  } else {
    $('#chat-info-btn').addClass('d-none').hide();
    $('#group-info-btn').addClass('d-none').hide();
  }
}
// Call updateInfoBtns on chat/group switch
$(document).on('click', '.group-item, .user-item', updateInfoBtns);

// --- Chat Info Modal Logic ---
$('#chat-info-btn').on('click', function() {
  if (!currentRecipients || currentRecipients.startsWith('group-')) return;
  // Populate chat info (show username, maybe last seen, etc.)
  let user = currentRecipients;
  let html = `<div><b>User:</b> ${user}</div>`;
  // Optionally, add more info (last seen, etc.)
  $('#chat-info-content').html(html);
  $('#chatInfoModal').modal('show');
});
// Delete Chat (clear history)
$('#delete-chat-btn').on('click', function() {
  if (!currentRecipients || currentRecipients.startsWith('group-')) return;
  showPopup({
    title: 'Delete Chat',
    message: 'Are you sure you want to delete this chat? This will clear the chat history for you.',
    icon: 'warning',
    okText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    onOk: function() {
      // Call backend to delete chat history (implement endpoint if needed)
      $.post('/delete_message', { user: currentRecipients }, function(resp) {
        // On success, clear chat body
        $('#chat-body').html('<div class="text-center text-muted">Chat deleted.</div>');
        $('#chatInfoModal').modal('hide');
      });
    }
  });
});
// Clear conversation handler for chat info modal
$(document).on('click', '#clear-chat-btn', function() {
  if (!currentRecipients || currentRecipients.startsWith('group-')) return;
  showPopup({
    title: 'Clear Conversation',
    message: 'Are you sure you want to clear this conversation? This will remove all messages for you, but not for the other user.',
    icon: 'warning',
    okText: 'Clear',
    cancelText: 'Cancel',
    showCancel: true,
    onOk: function() {
      $.post('/clear_chat', { user: currentRecipients }, function(resp) {
        if (resp.success) {
          $('#chat-body').html('<div class="text-center text-muted">Chat cleared.</div>');
          $('#chatInfoModal').modal('hide');
        } else {
          showPopup({
            title: 'Clear Failed',
            message: resp.error || 'Failed to clear chat',
            icon: 'error'
          });
        }
      });
    }
  });
});
// --- Group Info Modal Logic (already present, just ensure works) ---
$('#group-info-btn').on('click', function() {
  if (!currentRecipients || !currentRecipients.startsWith('group-')) return;
  // Existing logic should show group info modal
  // Optionally, reload group info here
  $('#groupInfoModal').modal('show');
});
// Clear group conversation handler for group info modal
$(document).on('click', '#clear-group-chat-btn', function() {
  if (!currentGroupId) return;
  showPopup({
    title: 'Clear Group Conversation',
    message: 'Are you sure you want to clear this group conversation? This will remove all group messages for you, but not for other members.',
    icon: 'warning',
    okText: 'Clear',
    cancelText: 'Cancel',
    showCancel: true,
    onOk: function() {
      $.post('/clear_group_chat', { group_id: currentGroupId }, function(resp) {
        if (resp.success) {
          $('#chat-body').html('<div class="text-center text-muted">Group chat cleared.</div>');
          $('#groupInfoModal').modal('hide');
        } else {
          showPopup({
            title: 'Clear Failed',
            message: resp.error || 'Failed to clear group chat',
            icon: 'error'
          });
        }
      });
    }
  });
});
// --- Suggestions for further improvements ---
// 1. Add search/filter in chat/group lists
// 2. Show last seen/online status in chat info
// 3. Add group icon upload/change
// 4. Add mute notifications for chats/groups
// 5. Add member roles and leave group option in group info

// --- Section Persistence Logic ---
function showSection(sectionName) {
    // Hide all sections
    $('.section-content').removeClass('active');
    // Show the requested section
    $('#' + sectionName + '-section').addClass('active');
    // Save to localStorage
    localStorage.setItem('lastSection', sectionName);
}

function fetchAndUpdateRequestBadges() {
    // Pending user requests
    $.get('/pending-requests', function(html) {
        // Count table rows with class 'table-warning' (pending requests)
        var pending = $(html).find('tr.table-warning').length;
        updateBadge('pending-requests-badge', pending);
    });
    // Pending reset requests
    $.get('/reset-requests', function(html) {
        // Count table rows with class 'table-warning' and data-reset attribute (pending resets)
        var resets = $(html).find('tr.table-warning[data-reset]').length;
        updateBadge('reset-requests-badge', resets);
    });
}

// Call this in the main polling function
function fetchAndUpdateUnreadCounts() {
    $.get('/unread_counts', function(data) {
        if (data.chats !== undefined) {
            updateBadge('chats-badge', data.chats);
        }
        if (data.groups !== undefined) {
            updateBadge('groups-badge', data.groups);
        }
    });
    fetchAndUpdateRequestBadges();
}

$(document).ready(function() {
    // Helper to show only the correct section
    function showSection(sectionName) {
        $('.section-content').removeClass('active');
        $('#' + sectionName + '-section').addClass('active');
        $('.nav-link').removeClass('active');
        $('.nav-link[data-section="' + sectionName + '"]').addClass('active');
        localStorage.setItem('lastSection', sectionName);
    }

    // Sidebar nav click handlers
    $(document).on('click', '.nav-link[data-section="chats"]', function(e) {
        e.preventDefault();
        showSection('chats');
        // Load user list only
        $.get('/users_status', updateUserListFromStatus);
        // Reset chat area
        $('#chat-title').text('Select a chat to start messaging');
        $('#chat-body').html('<div class="text-center text-muted">Select a user to start chatting.</div>');
        $('#message-input').val('');
    });
    $(document).on('click', '.nav-link[data-section="groups"]', function(e) {
        e.preventDefault();
        showSection('groups');
        // Load group list only
        loadGroups();
        // Reset group chat area
        $('#group-chat-title').text('Select a group to start messaging');
        $('#group-chat-body').html('<div class="text-center text-muted">Select a group to start chatting.</div>');
        $('#group-message-input').val('');
    });

    // On page load, show the correct section
    var lastSection = localStorage.getItem('lastSection');
    if (window.location.pathname.endsWith('/groups')) {
        showSection('groups');
        loadGroups();
    } else if (lastSection && $('#' + lastSection + '-section').length) {
        showSection(lastSection);
        if (lastSection === 'groups') {
            loadGroups();
        } else {
            $.get('/users_status', updateUserListFromStatus);
        }
    } else {
        showSection('chats');
        $.get('/users_status', updateUserListFromStatus);
    }
    fetchAndUpdateUnreadCounts();
    setInterval(fetchAndUpdateUnreadCounts, 10000); // Poll every 10 seconds

    // Also update badges in real time when a message is received
    socket.on('receive_message', function(msg) {
        fetchAndUpdateUnreadCounts();
    });
});

// Sidebar logo click: reload page
$(document).on('click', '#sidebar-logo-link', function(e) {
    e.preventDefault();
    location.reload();
});

// --- Universal Interactive Popup ---
function showPopup({
  title = 'Notification',
  message = '',
  okText = 'OK',
  cancelText = null,
  onOk = null,
  onCancel = null,
  showCancel = false,
  icon = null // e.g., 'success', 'error', 'info', 'warning'
} = {}) {
  $('#universalPopupTitle').text(title);
  let iconHtml = '';
  if (icon) {
    let iconClass = '';
    if (icon === 'success') iconClass = 'bi bi-check-circle-fill text-success';
    else if (icon === 'error') iconClass = 'bi bi-x-circle-fill text-danger';
    else if (icon === 'warning') iconClass = 'bi bi-exclamation-triangle-fill text-warning';
    else if (icon === 'info') iconClass = 'bi bi-info-circle-fill text-info';
    if (iconClass) iconHtml = `<i class='${iconClass}' style='font-size:2em;vertical-align:middle;margin-right:8px;'></i>`;
  }
  $('#universalPopupBody').html(`${iconHtml}${message}`);
  $('#universalPopupOkBtn').text(okText);
  if (showCancel) {
    if ($('#universalPopupCancelBtn').length === 0) {
      $('#universalPopupFooter').prepend(`<button type='button' class='btn btn-secondary' id='universalPopupCancelBtn' data-bs-dismiss='modal'>${cancelText || 'Cancel'}</button>`);
    } else {
      $('#universalPopupCancelBtn').text(cancelText || 'Cancel').show();
    }
  } else {
    $('#universalPopupCancelBtn').remove();
  }
  // Remove previous handlers
  $('#universalPopupOkBtn').off('click');
  if (onOk) {
    $('#universalPopupOkBtn').on('click', function() {
      setTimeout(onOk, 200); // Delay to allow modal to close
    });
  }
  if (showCancel && onCancel) {
    $('#universalPopupCancelBtn').off('click').on('click', function() {
      setTimeout(onCancel, 200);
    });
  }
  let modal = new bootstrap.Modal(document.getElementById('universalPopupModal'));
  modal.show();
}

function loadFilesTable() {
    $.get('/files_data', function(resp) {
        const tbody = $('#files-table-body');
        tbody.empty();
        if (!resp.files || resp.files.length === 0) {
            tbody.append('<tr><td colspan="5" class="text-center">No files found.</td></tr>');
            return;
        }
        resp.files.forEach(function(file) {
            // Determine if sent or received
            let type = (file.sender === USERNAME) ? 'Sent' : 'Received';
            let toFrom = (file.sender === USERNAME) ? file.recipients : file.sender;
            let row = `<tr>
                <td>${file.original_name}</td>
                <td>${type}</td>
                <td>${toFrom}</td>
                <td>${file.timestamp}</td>
                <td><a href="${file.download_url}" target="_blank" class="btn btn-sm btn-primary">Download</a></td>
            </tr>`;
            tbody.append(row);
        });
    });
}

$(document).on('click', '.nav-link[data-section="files"]', function(e) {
    setTimeout(loadFilesTable, 200); // Slight delay to ensure section is visible
});
