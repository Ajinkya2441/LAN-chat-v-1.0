$(document).ready(function() {
    // --- Requests Badge ---
    function updatePendingRequestsBadge() {
        let pending = $("table tr.table-warning").length;
        if (pending > 0) {
            $('#pending-requests-badge').text(pending).show();
        } else {
            $('#pending-requests-badge').hide();
        }
    }
    updatePendingRequestsBadge();
    $(document).on('submit', 'form', function() {
        setTimeout(updatePendingRequestsBadge, 500);
    });

    // --- Resets Badge ---
    function updateResetRequestsBadge() {
        let resets = $("table tr.table-warning[data-reset]").length;
        if (resets > 0) {
            $('#reset-requests-badge').text(resets).show();
        } else {
            $('#reset-requests-badge').hide();
        }
    }
    updateResetRequestsBadge();
    $(document).on('submit', 'form', function() {
        setTimeout(updateResetRequestsBadge, 500);
    });

    // --- Chats Badge (Unread) ---
    function updateChatsBadge(unreadCount) {
        if (unreadCount > 0) {
            $('#chats-badge').text(unreadCount).show();
        } else {
            $('#chats-badge').hide();
        }
    }
    // Placeholder: Replace with real unread count logic
    let unreadChats = 0;
    // Example: listen for a custom event or poll for unread count
    window.setUnreadChats = function(count) {
        unreadChats = count;
        updateChatsBadge(unreadChats);
    };
    // --- Real-time notifications ---
    if (typeof io !== 'undefined') {
        var socket = io();
        socket.on('new_user_request', function(data) {
            $('#pending-requests-badge').text('!').show();
            // Optionally, show a toast/alert
            if ($('#new-user-toast').length === 0) {
                $('body').append('<div id="new-user-toast" class="alert alert-info position-fixed top-0 end-0 m-3" style="z-index:9999;">New user request: <b>' + data.username + '</b></div>');
                setTimeout(function() { $('#new-user-toast').fadeOut(500, function() { $(this).remove(); }); }, 3500);
            }
        });
        socket.on('new_password_reset_request', function(data) {
            $('#reset-requests-badge').text('!').show();
            // Optionally, show a toast/alert
            if ($('#new-reset-toast').length === 0) {
                $('body').append('<div id="new-reset-toast" class="alert alert-warning position-fixed top-0 end-0 m-3" style="z-index:9999;">New password reset request: <b>' + data.username + '</b></div>');
                setTimeout(function() { $('#new-reset-toast').fadeOut(500, function() { $(this).remove(); }); }, 3500);
            }
        });
        // Example: listen for unread chat count (you must emit this from backend/socketio)
        socket.on('unread_chats', function(data) {
            if (typeof data.count !== 'undefined') {
                updateChatsBadge(data.count);
            }
        });
    }
});
