frappe.provide('frappe.canvas');

frappe.canvas.CollaborationSidebarVanilla = class CollaborationSidebarVanilla {
	constructor({ parent, canvas }) {
		this.$parent = $(parent);
		this.canvas = canvas;
		this.session_data = null;
		this.online_users = [];
		this.chat_messages = [];

		this.make();
		this.setup_realtime();
	}

	make() {
		this.$sidebar = $(`
			<div class="ccs-sidebar">
				${this.get_header_html()}
				<div class="ccs-content">
					<div class="ccs-session-info-container"></div>
					<div class="ccs-users-container"></div>
					<div class="ccs-chat-container"></div>
				</div>
			</div>
		`);

		this.$parent.append(this.$sidebar);

		this.$session_info = this.$sidebar.find('.ccs-session-info-container');
		this.$online_users = this.$sidebar.find('.ccs-users-container');
		this.$chat        = this.$sidebar.find('.ccs-chat-container');

		this.setup_events();
	}

	get_header_html() {
		return `
			<div class="ccs-header">
				<div class="ccs-header-content">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
						<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
					</svg>
					<h3 class="ccs-header-title">Collaboration</h3>
				</div>
				<button class="ccs-close-btn" title="Close sidebar">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
		`;
	}

	setup_events() {
		this.$sidebar.find('.ccs-close-btn').on('click', () => this.hide());
	}

	setup_realtime() {
		frappe.realtime.on('user_joined', (data) => {
			try {
				if (!data || !data.user) return;
				this.add_online_user(data);
			} catch (error) {
				this.show_connection_error('Failed to update online users');
			}
		});

		frappe.realtime.on('user_left', (data) => {
			try {
				if (!data || !data.user) return;
				this.remove_online_user(data);
			} catch (error) {}
		});

		frappe.realtime.on('canvas_chat_message', (data) => {
			try {
				if (!data || !data.message) return;
				this.add_chat_message(data);
			} catch (error) {
				this.show_connection_error('Failed to receive chat message');
			}
		});

		if (frappe.realtime?.socket) {
			frappe.realtime.socket.on('connect', () => {
				this.update_connection_status(true);
				this._reconnect_attempts = 0;
				if (this.canvas.active_session_id) {
					frappe.realtime.socket.emit('doc_subscribe', 'Canvas Session', this.canvas.active_session_id);
					frappe.show_alert({ message: __('Connection restored'), indicator: 'green' });
				}
			});

			frappe.realtime.socket.on('disconnect', (reason) => {
				this.update_connection_status(false);
				this._handle_disconnect(reason);
			});

			frappe.realtime.socket.on('connect_error', (error) => {
				this._reconnect_attempts = (this._reconnect_attempts || 0) + 1;
				if (this._reconnect_attempts <= 5) {
					this.show_connection_error(`Connection lost. Retry ${this._reconnect_attempts}/5...`);
				} else {
					this.show_connection_error('Unable to connect. Please refresh the page.');
				}
			});
		}
	}

	_handle_disconnect(reason) {
		if (reason === 'io server disconnect') {
			frappe.show_alert({ message: __('Disconnected from server. Please refresh the page.'), indicator: 'red' });
		} else {
			if (!this._disconnect_notified) {
				frappe.show_alert({ message: __('Connection lost. Reconnecting...'), indicator: 'orange' });
				this._disconnect_notified = true;
				setTimeout(() => { this._disconnect_notified = false; }, 10000);
			}
		}
	}

	refresh(session_data, online_users) {
		this.session_data  = session_data;
		this.online_users  = online_users || [];
		this.chat_messages = session_data?.chat_messages || [];

		this.render_session_info();
		this.render_online_users();
		this.render_chat();
		this.show();
	}

	render_session_info() {
		if (!this.session_data) return;

		const html = `
			<div class="ccs-section">
				<div class="ccs-session-meta">
					<div class="ccs-session-text">
						<h4 class="ccs-session-title">${this.session_data.title}</h4>
						<p class="ccs-session-subtitle">${this.session_data.base_doctype} Canvas</p>
					</div>
					<span class="ccs-session-id-badge" title="Click to copy ID">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
						</svg>
						${this.session_data.name.slice(-6)}
					</span>
				</div>

				<div class="ccs-owner-row">
					${frappe.avatar(this.session_data.owner, 'avatar-medium')}
					<div class="ccs-owner-info">
						<div class="ccs-owner-name">${frappe.user_info(this.session_data.owner).fullname}</div>
						<div class="ccs-owner-role">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"></path>
							</svg>
							Session Owner
						</div>
					</div>
					<div class="ccs-session-time">${frappe.datetime.comment_when(this.session_data.creation)}</div>
				</div>
			</div>
		`;

		this.$session_info.html(html);
		this.$session_info.find('.ccs-session-id-badge').on('click', () => {
			frappe.utils.copy_to_clipboard(this.session_data.name);
			frappe.show_alert({ message: __('Session ID copied!'), indicator: 'green' });
		});
	}

	render_online_users() {
		const html = `
			<div class="ccs-section">
				<div class="ccs-section-header">
					<div class="ccs-online-label">
						<span class="ccs-pulse-dot"></span>
						Online Now
					</div>
					<span class="ccs-online-count">${this.online_users.length}</span>
				</div>

				<div class="ccs-users-list">
					${this.online_users.length === 0 ? this.get_empty_users_html() : this.get_users_list_html()}
				</div>

				${this.is_owner() ? `
					<button class="ccs-invite-btn">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
							<circle cx="8.5" cy="7" r="4"></circle>
							<line x1="20" y1="8" x2="20" y2="14"></line>
							<line x1="23" y1="11" x2="17" y2="11"></line>
						</svg>
						Invite Team Members
					</button>
				` : ''}
			</div>
		`;

		this.$online_users.html(html);

		if (this.is_owner()) {
			this.$online_users.find('.ccs-invite-btn').on('click', () => this.show_invite_dialog());
		}
	}

	get_users_list_html() {
		return this.online_users.map(user => `
			<div class="ccs-user-item">
				${frappe.avatar(user.user, 'avatar-small')}
				<div class="ccs-user-info">
					<div class="ccs-user-name">${frappe.user_info(user.user).fullname}</div>
					<div class="ccs-user-status">
						<span class="ccs-status-dot"></span>
						Active
					</div>
				</div>
			</div>
		`).join('');
	}

	get_empty_users_html() {
		return `
			<div class="ccs-empty-state">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
					<circle cx="9" cy="7" r="4"></circle>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
				</svg>
				<p>No other users online</p>
			</div>
		`;
	}

	render_chat() {
		const html = `
			<div class="ccs-chat-section">
				<div class="ccs-chat-header">
					<div class="ccs-chat-title">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
						</svg>
						Team Chat
					</div>
					${this.chat_messages.length > 0 ? `<span class="ccs-msg-count">${this.chat_messages.length}</span>` : ''}
				</div>

				<div class="ccs-messages">
					${this.chat_messages.length === 0 ? this.get_empty_chat_html() : this.get_chat_messages_html()}
				</div>

				<div class="ccs-input-wrap">
					<input type="text" class="ccs-chat-input" placeholder="Type a message...">
					<button class="ccs-send-btn">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="22" y1="2" x2="11" y2="13"></line>
							<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
						</svg>
					</button>
				</div>
			</div>
		`;

		this.$chat.html(html);

		const $input    = this.$chat.find('.ccs-chat-input');
		const $send_btn = this.$chat.find('.ccs-send-btn');

		$input.on('keypress', (e) => {
			if (e.key === 'Enter' && $input.val().trim()) {
				this.send_message($input.val().trim());
				$input.val('');
			}
		});

		$send_btn.on('click', () => {
			if ($input.val().trim()) {
				this.send_message($input.val().trim());
				$input.val('');
			}
		});

		this.scroll_chat_to_bottom();
	}

	get_chat_messages_html() {
		return this.chat_messages.map(msg => {
			const is_me = msg.user === frappe.session.user;
			return `
				<div class="ccs-message ${is_me ? 'ccs-message--me' : 'ccs-message--other'}">
					${frappe.avatar(msg.user, 'avatar-small')}
					<div class="ccs-message-body">
						<div class="ccs-message-meta">
							<span class="ccs-msg-name">${frappe.user_info(msg.user).fullname}</span>
							<span class="ccs-msg-time">${frappe.datetime.comment_when(msg.timestamp)}</span>
						</div>
						<div class="ccs-bubble ${is_me ? 'ccs-bubble--me' : 'ccs-bubble--other'}">
							${frappe.utils.escape_html(msg.message)}
						</div>
					</div>
				</div>
			`;
		}).join('');
	}

	get_empty_chat_html() {
		return `
			<div class="ccs-empty-state ccs-empty-state--chat">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
					<line x1="9" y1="10" x2="15" y2="10"></line>
					<line x1="9" y1="14" x2="13" y2="14"></line>
				</svg>
				<p>No messages yet</p>
				<span>Start the conversation!</span>
			</div>
		`;
	}

	send_message(message) {
		if (!this.canvas.active_session_id) {
			frappe.show_alert({ message: __('Please start or join a session first'), indicator: 'orange' });
			return;
		}
		if (!message || message.trim().length === 0) return;
		if (message.length > 1000) {
			frappe.show_alert({ message: __('Message too long (max 1000 characters)'), indicator: 'orange' });
			return;
		}

		const $input    = this.$chat.find('.ccs-chat-input');
		const $send_btn = this.$chat.find('.ccs-send-btn');
		$send_btn.prop('disabled', true).css('opacity', '0.5');

		frappe.call({
			method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.add_chat_message',
			args: { session_id: this.canvas.active_session_id, message: message.trim() },
			callback: () => { $send_btn.prop('disabled', false).css('opacity', '1'); },
			error: (err) => {
				$send_btn.prop('disabled', false).css('opacity', '1');
				frappe.show_alert({ message: __('Failed to send message. Please try again.'), indicator: 'red' });
				$input.val(message);
			}
		});
	}

	add_chat_message(msg_data) {
		this.chat_messages.push(msg_data);
		this.render_chat();
	}

	add_online_user(user_data) {
		if (!this.online_users.find(u => u.user === user_data.user)) {
			this.online_users.push(user_data);
			this.render_online_users();
			frappe.show_alert({ message: __(`{0} joined the canvas`, [frappe.user_info(user_data.user).fullname]), indicator: 'green' }, 3);
		}
	}

	remove_online_user(user_data) {
		const username = user_data.user || user_data;
		this.online_users = this.online_users.filter(u => u.user !== username);
		this.render_online_users();
		frappe.show_alert({ message: __(`{0} left the canvas`, [frappe.user_info(username).fullname]), indicator: 'orange' }, 3);
	}

	show_invite_dialog() {
		if (!this.canvas.active_session_id) {
			frappe.msgprint(__('Please start a session first'));
			return;
		}

		const dialog = new frappe.ui.Dialog({
			title: __('Invite Team Members'),
			fields: [
				{ fieldtype: 'Data', fieldname: 'session_id', label: __('Session ID'), read_only: 1, default: this.canvas.active_session_id },
				{
					fieldtype: 'HTML', fieldname: 'instructions',
					options: `
						<div style="padding:12px;background:var(--bg-color);border-radius:6px;margin-top:12px;">
							<p style="margin:0 0 8px 0;font-size:13px;color:var(--text-color);font-weight:500;">How to join:</p>
							<ol style="margin:0;padding-left:20px;font-size:12px;color:var(--text-muted);">
								<li>Go to <strong>${this.session_data.base_doctype}</strong> in Desk</li>
								<li>Switch to <strong>Excel View</strong></li>
								<li>Click <strong>Collaborate</strong> button</li>
								<li>Go to <strong>Join Existing</strong> tab</li>
								<li>Paste the Session ID and click <strong>Join</strong></li>
							</ol>
						</div>
					`
				}
			],
			primary_action_label: __('Copy Session ID'),
			primary_action: (values) => {
				frappe.utils.copy_to_clipboard(values.session_id);
				frappe.show_alert({ message: __('Session ID copied to clipboard!'), indicator: 'green' });
				dialog.hide();
			}
		});
		dialog.show();
	}

	scroll_chat_to_bottom() {
		const $messages = this.$chat.find('.ccs-messages');
		$messages.scrollTop($messages[0].scrollHeight);
	}

	is_owner() {
		return this.session_data && this.session_data.owner === frappe.session.user;
	}

	show() { this.$sidebar.css('display', 'flex').hide().fadeIn(200); }
	hide() { this.$sidebar.fadeOut(200); }
	destroy() { this.$sidebar.remove(); }

	update_connection_status(connected) {
		const $header = this.$sidebar.find('.ccs-header');
		if (!this.$connection_indicator) {
			this.$connection_indicator = $('<div class="ccs-conn-dot"></div>').appendTo($header.find('.ccs-header-content'));
		}
		this.$connection_indicator.toggleClass('ccs-conn-dot--off', !connected);
	}

	show_connection_error(message) {
		const now = Date.now();
		if (this._last_error_time && (now - this._last_error_time) < 5000) return;
		this._last_error_time = now;
		frappe.show_alert({ message: __(message), indicator: 'red' });
	}
};
