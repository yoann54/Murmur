/*
 * chat.js — conversation history, bounded and consistent.
 *
 * PebbleAI corrupted Claude's history (bug #4): it pushed the assistant reply
 * into a global messages array but never pushed the matching user prompt, so
 * the next turn sent an inconsistent transcript. And it never bounded the array
 * (bug #5), so a long session grew the payload without limit.
 *
 * Here, a turn is always recorded as a (user, assistant) pair via addUser() +
 * addAssistant(), and the history is trimmed to the last `maxTurns` exchanges.
 */

function Conversation(maxTurns) {
  this.maxTurns = (maxTurns && maxTurns > 0) ? maxTurns : 6;
  this.messages = [];
}

Conversation.prototype._trim = function () {
  var max = this.maxTurns * 2;
  if (this.messages.length > max) {
    this.messages = this.messages.slice(this.messages.length - max);
  }
};

Conversation.prototype.addUser = function (text) {
  this.messages.push({ role: 'user', content: text });
  this._trim();
};

Conversation.prototype.addAssistant = function (text) {
  this.messages.push({ role: 'assistant', content: text });
  this._trim();
};

/* Drop the trailing message — used to roll back a user turn whose request failed,
 * so a retry doesn't double up the prompt. */
Conversation.prototype.dropLast = function () {
  this.messages.pop();
};

Conversation.prototype.reset = function () {
  this.messages = [];
};

/* A defensive copy for passing to a provider's buildRequest(). */
Conversation.prototype.snapshot = function () {
  return this.messages.map(function (m) {
    return { role: m.role, content: m.content };
  });
};

module.exports = Conversation;
