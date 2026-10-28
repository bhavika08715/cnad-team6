// Notification Service
const { db, id, save } = require('./db');

function notify(userId, title, message, surplusId = null) {
  db.notifications.push({
    id: id('n'),
    userId,
    title,
    message,
    surplusId,
    read: false,
    at: new Date().toISOString(),
  });
  save();
}

function list(userId) {
  return db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);
}

function unreadCount(userId) {
  return db.notifications.filter((n) => n.userId === userId && !n.read).length;
}

function markAllRead(userId) {
  db.notifications.forEach((n) => {
    if (n.userId === userId) n.read = true;
  });
  save();
}

module.exports = { notify, list, unreadCount, markAllRead };
