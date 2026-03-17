app_name = "excel_view"
app_title = "Excel View"
app_publisher = "Ujjwal Aggrawal"
app_description = "Adding Excel View as default view"
app_email = "ujjmee2279@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "excel_view",
# 		"logo": "/assets/excel_view/logo.png",
# 		"title": "Excel View",
# 		"route": "/excel_view",
# 		"has_permission": "excel_view.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# Router bundle (~2KB) — loads on every Frappe page to register the view
# and monkey-patch routing. Zero cost for non-Excel-View users.
app_include_js = ["excel_view_router.bundle.js", "collaboration_sidebar.bundle.js", "collaboration_dialog.bundle.js"]

# CSS — always include (tiny, needed for ev-page-active z-index fix etc.)
app_include_css = ["excel_view.bundle.css", "collaboration_dialog.bundle.css"]

# The full deps bundle (excel_view.bundle.js, ~1.4MB with HOT + HF + deps)
# is NOT listed here. It is loaded dynamically by excel_view_router.bundle.js
# via a <script> tag injection when the user first opens Excel View.

# include js, css files in header of web template
# web_include_css = "/assets/excel_view/css/excel_view.css"
# web_include_js = "/assets/excel_view/js/excel_view.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "excel_view/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "excel_view/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "excel_view.utils.jinja_methods",
# 	"filters": "excel_view.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "excel_view.install.before_install"
# after_install = "excel_view.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "excel_view.uninstall.before_uninstall"
# after_uninstall = "excel_view.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "excel_view.utils.before_app_install"
# after_app_install = "excel_view.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "excel_view.utils.before_app_uninstall"
# after_app_uninstall = "excel_view.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "excel_view.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

scheduler_events = {
	"hourly": [
		"excel_view.tasks.hourly"
	],
# 	"all": [
# 		"excel_view.tasks.all"
# 	],
# 	"daily": [
# 		"excel_view.tasks.daily"
# 	],
# 	"weekly": [
# 		"excel_view.tasks.weekly"
# 	],
# 	"monthly": [
# 		"excel_view.tasks.monthly"
# 	],
}

# Testing
# -------

# before_tests = "excel_view.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "excel_view.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "excel_view.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["excel_view.utils.before_request"]
# after_request = ["excel_view.utils.after_request"]

# Job Events
# ----------
# before_job = ["excel_view.utils.before_job"]
# after_job = ["excel_view.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"excel_view.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

# Socket.IO
# ---------
# NOTE: socketio_port is managed by Frappe/Frappe Cloud automatically.
# Do not override unless running in local development with custom setup.
# For Frappe Cloud deployment, this is handled by the platform.

