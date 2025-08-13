$(function() {
    if (typeof io !== 'undefined') {
        var socket = io();
        socket.on('new_user_request', function(data) {
            $('#admin-dashboard-badge').show();
        });
        socket.on('new_password_reset_request', function(data) {
            $('#admin-dashboard-badge').show();
        });
    }
    // Optionally, hide badge when admin visits dashboard
    if (window.location.pathname === '/admin') {
        $('#admin-dashboard-badge').hide();
    }
});
