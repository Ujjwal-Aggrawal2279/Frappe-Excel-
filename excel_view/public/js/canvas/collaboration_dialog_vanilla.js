frappe.provide('frappe.canvas');

frappe.canvas.CollaborationDialogVanilla = class CollaborationDialogVanilla {
	constructor({ canvas }) {
		this.canvas = canvas;
		this.active_tab = 'start';
		this.session_title = '';
		this.session_list = [];
	}

	show() {
		if (this.dialog) this.hide();
		this.session_title = this.get_default_title();
		this.make_dialog();
		this.load_sessions();
		this.dialog.show();
		requestAnimationFrame(() => {
			this.dialog.$wrapper.css('z-index', 2000);
			$('.modal-backdrop').last().css('z-index', 1999);
		});
	}

	get_default_title() {
		const doctype = this.canvas.board?.doctype || this.canvas.doctype;
		const now = frappe.datetime.now_datetime().replace(/[-:]/g, '-').replace(' ', ' ');
		return `${doctype} Canvas - ${now.slice(0, 19)}`;
	}

	make_dialog() {
		this.dialog = new frappe.ui.Dialog({
			title: '',
			size: 'large',
			minimizable: false,
			fields: [{ fieldtype: 'HTML', fieldname: 'collaboration_content' }],
			onhide: () => {
				setTimeout(() => {
					$('.modal-backdrop').remove();
					$('body').removeClass('modal-open').css('overflow', '');
					if (this.dialog?.$wrapper) this.dialog.$wrapper.remove();
					this.dialog = null;
				}, 100);
			}
		});

		// Hide default Frappe dialog title bar — we render our own header
		this.dialog.$wrapper.find('.modal-header').hide();
		this.dialog.$wrapper.find('.modal-body').css('padding', '0');
		this.dialog.$wrapper.addClass('collab-dlg-wrapper');
		this.render_content();
	}

	render_content() {
		const is_start = this.active_tab === 'start';
		const html = `
		<div class="collab-dlg">
			<!-- Gradient header -->
			<div class="collab-dlg-head">
				<div class="collab-dlg-head-inner">
					<div class="collab-dlg-head-icon">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
							<circle cx="9" cy="7" r="4"/>
							<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
							<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
						</svg>
					</div>
					<div>
						<div class="collab-dlg-head-title">Collaborate</div>
						<div class="collab-dlg-head-sub">Real-time canvas workspace</div>
					</div>
				</div>
				<button class="collab-dlg-close" title="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>

			<!-- Tabs -->
			<div class="collab-dlg-tabs">
				<button class="collab-dlg-tab ${is_start ? 'collab-dlg-tab--active' : ''}" data-tab="start">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
					</svg>
					Start New Session
				</button>
				<button class="collab-dlg-tab ${!is_start ? 'collab-dlg-tab--active' : ''}" data-tab="join">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
						<polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
					</svg>
					Join Existing
				</button>
			</div>

			<!-- Content -->
			<div class="collab-dlg-body">
				<div class="collab-dlg-pane" style="display:${is_start ? 'flex' : 'none'}">
					${this.get_start_tab_html()}
				</div>
				<div class="collab-dlg-pane" style="display:${!is_start ? 'flex' : 'none'}">
					${this.get_join_tab_html()}
				</div>
			</div>
		</div>`;

		this.dialog.fields_dict.collaboration_content.$wrapper.html(html);
		this.setup_tab_events();
	}

	get_start_tab_html() {
		return `
		<div class="collab-dlg-hero">
			<div class="collab-dlg-hero-orb">
				<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
					<circle cx="9" cy="7" r="4"/>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
				</svg>
			</div>
			<h3 class="collab-dlg-hero-title">Start a New Canvas Session</h3>
			<p class="collab-dlg-hero-sub">Create a workspace where your team can build join canvases together in real-time</p>
		</div>

		<div class="collab-dlg-card">
			<label class="collab-dlg-label">Session Title</label>
			<input type="text" class="collab-dlg-input session-title-input"
				value="${frappe.utils.escape_html(this.session_title)}"
				placeholder="Enter session title...">
			<div class="collab-dlg-hint">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
				</svg>
				A unique ID will be generated — share it with team members to let them join
			</div>
		</div>

		<button class="collab-dlg-btn collab-dlg-btn--primary btn-start-session">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
			</svg>
			Start Session
		</button>`;
	}

	get_join_tab_html() {
		return `
		<div class="collab-dlg-hero">
			<div class="collab-dlg-hero-orb collab-dlg-hero-orb--join">
				<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
					<polyline points="10 17 15 12 10 7"/>
					<line x1="15" y1="12" x2="3" y2="12"/>
				</svg>
			</div>
			<h3 class="collab-dlg-hero-title">Join an Existing Session</h3>
			<p class="collab-dlg-hero-sub">Paste a Session ID or pick one from the active sessions below</p>
		</div>

		<div class="collab-dlg-card collab-dlg-card--join-id">
			<label class="collab-dlg-label">Session ID</label>
			<div class="collab-dlg-row">
				<input type="text" class="collab-dlg-input manual-session-id-input"
					placeholder="e.g.  e7bf4b56">
				<button class="collab-dlg-btn collab-dlg-btn--sm btn-manual-join">Join</button>
			</div>
			<div class="collab-dlg-hint">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
				</svg>
				Ask your team member for the Session ID they received when starting the session
			</div>
		</div>

		<div class="collab-dlg-sessions-head">
			<span class="collab-dlg-sessions-label">Active Sessions</span>
			<span class="collab-dlg-sessions-badge">${this.session_list.length}</span>
		</div>

		<div class="sessions-list collab-dlg-sessions-list">
			${this.get_sessions_list_html()}
		</div>`;
	}

	get_sessions_list_html() {
		if (!this.session_list || this.session_list.length === 0) {
			return `
			<div class="collab-dlg-empty">
				<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
					<circle cx="9" cy="7" r="4"/>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
				</svg>
				<div class="collab-dlg-empty-title">No active sessions</div>
				<div class="collab-dlg-empty-sub">Switch to "Start New Session" to create one</div>
			</div>`;
		}

		return this.session_list.map(session => `
		<div class="collab-dlg-session-card" data-session-id="${session.name}">
			<div class="collab-dlg-session-main">
				<div class="collab-dlg-session-info">
					<div class="collab-dlg-session-title">${frappe.utils.escape_html(session.title)}</div>
					<div class="collab-dlg-session-meta">${frappe.utils.escape_html(session.base_doctype)} Canvas</div>
				</div>
				<span class="collab-dlg-session-status">Live</span>
			</div>
			<div class="collab-dlg-session-footer">
				<div class="collab-dlg-session-owner">
					${frappe.avatar(session.owner, 'avatar-small')}
					<div>
						<div class="collab-dlg-session-owner-name">${frappe.user_info(session.owner).fullname}</div>
						<div class="collab-dlg-session-owner-time">${frappe.datetime.comment_when(session.creation)}</div>
					</div>
				</div>
				<button class="collab-dlg-btn collab-dlg-btn--sm btn-join-session" data-session-id="${session.name}">
					Join →
				</button>
			</div>
		</div>`).join('');
	}

	setup_tab_events() {
		const $c = this.dialog.fields_dict.collaboration_content.$wrapper;

		$c.find('.collab-dlg-close').on('click', () => this.hide());

		$c.find('.collab-dlg-tab').on('click', (e) => {
			this.active_tab = $(e.currentTarget).data('tab');
			this.render_content();
		});

		$c.find('.btn-start-session').on('click', () => {
			const title = $c.find('.session-title-input').val().trim();
			if (!title) {
				frappe.show_alert({ message: __('Please enter a session title'), indicator: 'orange' });
				return;
			}
			this.start_session(title);
		});

		$c.find('.btn-switch-to-start').on('click', () => {
			this.active_tab = 'start';
			this.render_content();
		});

		$c.find('.btn-join-session').on('click', (e) => {
			let id = $(e.currentTarget).data('session-id');
			id = String(id).split('?')[0].split('#')[0].trim();
			this.join_session(id);
		});

		$c.find('.btn-manual-join').on('click', () => {
			let id = $c.find('.manual-session-id-input').val().trim();
			if (!id) {
				frappe.show_alert({ message: __('Please enter a Session ID'), indicator: 'orange' });
				return;
			}
			id = id.split('?')[0].split('#')[0].trim();
			this.join_session(id);
		});

		$c.find('.manual-session-id-input').on('keypress', (e) => {
			if (e.key === 'Enter') $c.find('.btn-manual-join').click();
		});
	}

	async load_sessions() {
		try {
			const doctype = this.canvas.board?.doctype || this.canvas.doctype;
			const res = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.get_active_sessions',
				args: { doctype }
			});
			this.session_list = res.message || [];
			if (this.active_tab === 'join') this.render_content();
		} catch (err) {
			console.error('Failed to load sessions:', err);
			this.session_list = [];
		}
	}

	async start_session(title) {
		try {
			const doctype = this.canvas.board?.doctype || this.canvas.doctype;
			const canvas_state = this.canvas._get_canvas_state();
			const res = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.create_session',
				args: { title, base_doctype: doctype, canvas_state }
			});
			if (res.message) {
				this.dialog.hide();
				if (this.canvas._join_session) await this.canvas._join_session(res.message.session_id);
				frappe.show_alert({ message: __('Session started!'), indicator: 'green' });
			}
		} catch (err) {
			console.error('Failed to start session:', err);
			frappe.show_alert({ message: __('Failed to start session'), indicator: 'red' });
		}
	}

	async join_session(session_id) {
		try {
			this.dialog.hide();
			if (this.canvas._join_session) await this.canvas._join_session(session_id);
			frappe.show_alert({ message: __('Joining session...'), indicator: 'blue' });
		} catch (err) {
			console.error('Failed to join session:', err);
			frappe.show_alert({ message: __('Failed to join session'), indicator: 'red' });
		}
	}

	hide() {
		if (this.dialog) this.dialog.hide();
	}
};
