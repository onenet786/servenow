import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:provider/provider.dart';
import '../providers/notification_provider.dart' as app_notif;
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'ui/ui.dart';

class NotificationBellWidget extends StatefulWidget {
  const NotificationBellWidget({super.key});

  @override
  State<NotificationBellWidget> createState() => _NotificationBellWidgetState();
}

class _NotificationBellWidgetState extends State<NotificationBellWidget> {
  late OverlayEntry _overlayEntry;
  bool _isOverlayShown = false;

  void _showNotificationPanel() {
    if (_isOverlayShown) {
      _overlayEntry.remove();
      _isOverlayShown = false;
      return;
    }

    _overlayEntry = OverlayEntry(
      builder: (context) {
        final screenWidth = MediaQuery.of(context).size.width;
        final panelWidth = (screenWidth - 16).clamp(280.0, 360.0);
        return Positioned(
          top: 60,
          right: 8,
          width: panelWidth,
          child: GestureDetector(
            onTap: () {},
            child: Material(
              elevation: 8,
              color: AppColors.surface,
              shadowColor: const Color(0x33111827),
              borderRadius: AppRadius.cardAll,
              clipBehavior: Clip.antiAlias,
              child: _NotificationPanel(
                onClose: _hideNotificationPanel,
              ),
            ),
          ),
        );
      },
    );

    Overlay.of(context).insert(_overlayEntry);
    _isOverlayShown = true;
  }

  void _hideNotificationPanel() {
    if (_isOverlayShown) {
      _overlayEntry.remove();
      _isOverlayShown = false;
    }
  }

  @override
  void dispose() {
    if (_isOverlayShown) {
      _overlayEntry.remove();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<app_notif.NotificationProvider>(
      builder: (context, notificationProvider, _) {
        final unreadCount = notificationProvider.unreadCount;

        return GestureDetector(
          onTap: _showNotificationPanel,
          child: Semantics(
            label: 'Notifications',
            button: true,
            enabled: true,
            child: Center(
              child: Stack(
                children: [
                  IconButton(
                    icon: const Icon(Icons.notifications_outlined),
                    onPressed: _showNotificationPanel,
                    tooltip: 'Notifications',
                  ),
                  if (unreadCount > 0)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.danger,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.surface, width: 1.5),
                        ),
                        constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                        child: Center(
                          child: Text(
                            unreadCount > 99 ? '99+' : unreadCount.toString(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              fontFeatures: AppText.tabular,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _NotificationPanel extends StatefulWidget {
  final VoidCallback onClose;

  const _NotificationPanel({required this.onClose});

  @override
  State<_NotificationPanel> createState() => _NotificationPanelState();
}

class _NotificationPanelState extends State<_NotificationPanel> {
  @override
  void initState() {
    super.initState();
    _closeOnTapOutside();
  }

  void _closeOnTapOutside() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (mounted) {
        GestureBinding.instance.pointerRouter.addGlobalRoute(_handlePointerEvent);
      }
    });
  }

  void _handlePointerEvent(PointerEvent event) {
    if (event is PointerDownEvent) {
      final tapPosition = event.position;
      final renderBox = context.findRenderObject() as RenderBox?;
      if (renderBox != null) {
        final localPosition = renderBox.globalToLocal(tapPosition);
        final rect = Offset.zero & renderBox.size;
        if (rect.contains(localPosition)) {
          // Tap inside panel; ignore
          return;
        }
      }
      GestureBinding.instance.pointerRouter.removeGlobalRoute(_handlePointerEvent);
      widget.onClose();
    }
  }

  @override
  void dispose() {
    GestureBinding.instance.pointerRouter.removeGlobalRoute(_handlePointerEvent);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<app_notif.NotificationProvider>(
      builder: (context, notificationProvider, _) {
        final notifications = notificationProvider.notifications;

        return Container(
          constraints: const BoxConstraints(maxHeight: 500),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: AppRadius.cardAll,
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 8, 10),
                decoration: const BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: AppColors.border),
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Semantics(
                        header: true,
                        child: Text('Notifications', style: AppText.title),
                      ),
                    ),
                    if (notifications.isNotEmpty)
                      IconButton(
                        icon: const Icon(
                          Icons.delete_sweep_outlined,
                          color: AppColors.text2,
                        ),
                        onPressed: () {
                          notificationProvider.clearNotifications();
                          widget.onClose();
                        },
                        tooltip: 'Clear all',
                      ),
                    if (notifications.isEmpty) const SizedBox(height: 40),
                  ],
                ),
              ),
              Expanded(
                child: notifications.isEmpty
                    ? const SingleChildScrollView(
                        child: EmptyState(
                          compact: true,
                          icon: Icons.notifications_none_rounded,
                          title: 'No notifications',
                          message:
                              'Order updates and offers will show up here.',
                        ),
                      )
                    : ListView.builder(
                        shrinkWrap: true,
                        padding: EdgeInsets.zero,
                        itemCount: notifications.length,
                        itemBuilder: (context, index) {
                          final notification = notifications[index];
                          return _NotificationItem(
                            notification: notification,
                            onTap: () {
                              notificationProvider.markAsRead(notification.id);
                              widget.onClose();
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _NotificationItem extends StatefulWidget {
  final app_notif.Notification notification;
  final VoidCallback onTap;

  const _NotificationItem({
    required this.notification,
    required this.onTap,
  });

  @override
  State<_NotificationItem> createState() => _NotificationItemState();
}

class _NotificationItemState extends State<_NotificationItem> {
  bool _isMuting = false;

  Map<String, dynamic> get _payload =>
      widget.notification.payload ?? const {};

  bool get _isStoreDueAlert =>
      (_payload['type'] ?? '').toString() == 'store_due_alert';

  int get _storeId =>
      int.tryParse((_payload['store_id'] ?? '').toString()) ?? 0;

  String get _storeName =>
      (_payload['store_name'] ?? '').toString().trim();

  IconData _getIconData(String icon) {
    switch (icon) {
      case 'person_add':
        return Icons.person_add;
      case 'shopping_bag':
        return Icons.shopping_bag;
      case 'assignment':
        return Icons.assignment;
      case 'assignment_turned_in':
        return Icons.assignment_turned_in;
      case 'inventory_2':
        return Icons.inventory_2;
      case 'payment':
        return Icons.payment;
      case 'check_circle':
        return Icons.check_circle;
      case 'task_alt':
        return Icons.task_alt;
      case 'check':
        return Icons.check;
      case 'schedule':
        return Icons.schedule;
      case 'store':
        return Icons.store;
      case 'warning':
        return Icons.warning_amber;
      default:
        return Icons.info;
    }
  }

  Color _getIconColor(String type) {
    switch (type) {
      case 'success':
        return AppColors.success;
      case 'error':
        return AppColors.danger;
      case 'warning':
        return AppColors.warning;
      case 'info':
      default:
        return AppColors.primaryPressed;
    }
  }

  Color _getIconBackground(String type) {
    switch (type) {
      case 'success':
        return AppColors.successBg;
      case 'error':
        return AppColors.dangerBg;
      case 'warning':
        return AppColors.warningBg;
      case 'info':
      default:
        return AppColors.tint100;
    }
  }

  String _getTimeAgo(DateTime dateTime) {
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.inSeconds < 60) {
      return 'Just now';
    } else if (difference.inMinutes < 60) {
      return '${difference.inMinutes}m ago';
    } else if (difference.inHours < 24) {
      return '${difference.inHours}h ago';
    } else {
      return Fmt.dateTime(dateTime);
    }
  }

  Future<void> _muteStoreAlert(int hours) async {
    if (_isMuting) return;
    if (_storeId <= 0) return;
    final auth = context.read<AuthProvider>();
    final token = auth.token;
    if (token == null || token.trim().isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Session expired. Please login again.')),
      );
      return;
    }

    setState(() => _isMuting = true);
    try {
      final response = await ApiService.muteStoreGraceAlert(
        token,
        _storeId,
        hours: hours,
      );
      if (!mounted) return;
      if (response['success'] == true) {
        final label =
            _storeName.isEmpty ? 'Store due alert muted.' : '$_storeName due alert muted.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(label)),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(response['message'] ?? 'Failed to mute alert')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Failed to mute alert: ${e.toString().replaceFirst('Exception: ', '')}',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _isMuting = false);
    }
  }

  Future<void> _showCustomMuteDialog() async {
    final controller = TextEditingController(text: '24');
    final hours = await showDialog<int>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Mute Due Alert'),
          content: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Hours',
              hintText: 'e.g. 4, 12, 24',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final parsed = int.tryParse(controller.text.trim());
                Navigator.of(ctx).pop(parsed);
              },
              child: const Text('Mute'),
            ),
          ],
        );
      },
    );

    final safeHours = (hours ?? 0);
    if (safeHours > 0) {
      await _muteStoreAlert(safeHours);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notification = widget.notification;
    final canMute = _isStoreDueAlert && _storeId > 0;
    final showUnread = notification.unread;
    final trailing = (canMute || showUnread)
        ? Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (canMute)
                PopupMenuButton<int>(
                  icon: _isMuting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.notifications_off_outlined, size: 18),
                  tooltip: 'Mute due alert',
                  onSelected: (value) async {
                    if (value == -1) {
                      await _showCustomMuteDialog();
                    } else {
                      await _muteStoreAlert(value);
                    }
                  },
                  itemBuilder: (ctx) => [
                    const PopupMenuItem(value: 1, child: Text('Mute 1 hour')),
                    const PopupMenuItem(value: 4, child: Text('Mute 4 hours')),
                    const PopupMenuItem(value: 12, child: Text('Mute 12 hours')),
                    const PopupMenuItem(value: 24, child: Text('Mute 24 hours')),
                    const PopupMenuItem(value: 72, child: Text('Mute 3 days')),
                    const PopupMenuDivider(),
                    const PopupMenuItem(value: -1, child: Text('Custom...')),
                  ],
                ),
              if (showUnread)
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
            ],
          )
        : const SizedBox.shrink();

    return InkWell(
      onTap: widget.onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: const Border(
            bottom: BorderSide(color: AppColors.border),
          ),
          color: notification.unread ? AppColors.tint50 : Colors.transparent,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: _getIconBackground(notification.type),
                shape: BoxShape.circle,
              ),
              child: Icon(
                _getIconData(notification.icon),
                color: _getIconColor(notification.type),
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notification.title,
                    style: AppText.bodyStrong.copyWith(
                      fontWeight: notification.unread
                          ? FontWeight.w700
                          : FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    notification.message,
                    style: AppText.small,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _getTimeAgo(notification.timestamp),
                    style: AppText.caption,
                  ),
                ],
              ),
            ),
            if (canMute || showUnread) trailing,
          ],
        ),
      ),
    );
  }
}
