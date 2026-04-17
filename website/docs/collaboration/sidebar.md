---
id: sidebar
title: Collaboration Sidebar
sidebar_label: Collaboration Sidebar
---

# Collaboration Sidebar

The Collaboration Sidebar shows who else is viewing the same DocType and recent activity.

---

## Opening the Sidebar

Click the **chat-bubble icon** in the top-right corner of the toolbar, or press **Ctrl+Shift+K**.

The sidebar slides in from the right. Click the same button or press Escape to close it.

---

## What the Sidebar Shows

### Active Users
A list of users currently viewing the same DocType in Excel View. Avatars update in real time via Frappe's realtime (Socket.IO) channel.

### Recent Activity
A feed of recent changes to the DocType:
- New records created
- Records modified
- Comments added
- Assignments made

Activity items show the user, action, document name, and relative timestamp.

### Notifications
Any mentions (`@yourname`) in comments on documents of this DocType are highlighted.

---

## Realtime Updates

The sidebar listens to Frappe's `list_update` event for the current DocType. When any user saves a record, the grid and sidebar both update within ~1 second.

---

## Dark Theme

The sidebar is fully dark-theme compatible. All colors use Frappe CSS variables. The header gradient (`#667eea → #764ba2`) is a brand color and stays the same in both themes.
