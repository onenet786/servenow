import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_text.dart';
import '../utils/customer_language.dart';
import '../utils/formatters.dart';
import '../widgets/ui/language_scope.dart';

/// Single source of truth for the customer support contact.
///
/// Today the app shows whatever `GET /api/orders/customer-support-contact`
/// returns. The server reads `support_phone`, `support_whatsapp`,
/// `support_email` and `support_name` from `system_settings`, and falls back
/// to the FIRST ADMIN USER's phone/email when they are not set - which is why
/// a personal Gmail address was being shown as "support".
///
/// OWNER ACTION: set the `support_*` rows in `system_settings` (preferred, no
/// app release needed) or fill the overrides below. A non-empty override
/// always wins over the server value. They are intentionally empty: no new
/// address or number has been invented.
class SupportContactConfig {
  SupportContactConfig._();

  static const String overrideName = '';
  static const String overridePhone = '';
  static const String overrideWhatsApp = '';
  static const String overrideEmail = '';

  /// Subject line used for support e-mails.
  static const String emailSubject = 'ServeNow Support';
}

class SupportContact {
  final String name;
  final String phone;
  final String whatsapp;
  final String email;

  const SupportContact({
    this.name = '',
    this.phone = '',
    this.whatsapp = '',
    this.email = '',
  });

  bool get isEmpty => phone.isEmpty && whatsapp.isEmpty && email.isEmpty;

  /// Merges a server payload with [SupportContactConfig] overrides.
  factory SupportContact.fromServer(Map<String, dynamic>? data) {
    String pick(String override, dynamic server) {
      final o = override.trim();
      if (o.isNotEmpty) return o;
      return (server ?? '').toString().trim();
    }

    final map = data ?? const <String, dynamic>{};
    final phone = pick(SupportContactConfig.overridePhone, map['phone']);
    var whatsapp = pick(SupportContactConfig.overrideWhatsApp, map['whatsapp']);
    // Existing behaviour: WhatsApp uses the call number when there is one.
    if (SupportContactConfig.overrideWhatsApp.trim().isEmpty &&
        phone.isNotEmpty) {
      whatsapp = phone;
    }
    return SupportContact(
      name: pick(SupportContactConfig.overrideName, map['name']),
      phone: phone,
      whatsapp: whatsapp,
      email: pick(SupportContactConfig.overrideEmail, map['email']),
    );
  }

  static SupportContact? _cache;

  /// Loads (and caches for the session) the support contact.
  static Future<SupportContact> load(
    String? token, {
    bool refresh = false,
  }) async {
    if (!refresh && _cache != null && !_cache!.isEmpty) return _cache!;
    Map<String, dynamic>? data;
    if (token != null && token.trim().isNotEmpty) {
      try {
        data = await ApiService.getCustomerSupportContact(token);
      } catch (_) {}
    }
    final contact = SupportContact.fromServer(data);
    _cache = contact;
    return contact;
  }

  static Future<void> dial(String phoneNumber) async {
    final cleaned = phoneNumber.trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) return;
    final uri = Uri(scheme: 'tel', path: cleaned);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  static Future<void> openWhatsApp(String phoneNumber) async {
    var cleanPhone = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanPhone.isEmpty) return;
    if (cleanPhone.startsWith('0') && cleanPhone.length == 11) {
      cleanPhone = '92${cleanPhone.substring(1)}';
    } else if (cleanPhone.startsWith('0092')) {
      cleanPhone = cleanPhone.substring(2);
    }
    final uri = Uri.parse('https://wa.me/$cleanPhone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  static Future<void> sendEmail(String address) async {
    final cleaned = address.trim();
    if (cleaned.isEmpty) return;
    final uri = Uri(
      scheme: 'mailto',
      path: cleaned,
      queryParameters: {'subject': SupportContactConfig.emailSubject},
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

/// The one "Contact support" sheet used across customer screens.
Future<void> showSupportContactSheet(
  BuildContext context, {
  required SupportContact contact,
  bool isUrdu = false,
  String? title,
}) async {
  String tr(String s) => CustomerLanguage.tr(isUrdu, s);
  if (contact.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(tr('Support contact is not configured yet.'))),
    );
    return;
  }

  Widget option({
    required IconData icon,
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.sm),
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.controlAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpace.md,
              vertical: AppSpace.md,
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: const BoxDecoration(
                    color: AppColors.tint100,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: AppColors.primaryPressed, size: 20),
                ),
                const SizedBox(width: AppSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: AppText.bodyStrong),
                      Text(
                        Fmt.isolate(value),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.muted,
                  textDirection: TextDirection.ltr,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      void run(Future<void> Function() action) {
        Navigator.of(sheetContext).pop();
        action();
      }

      return LanguageScope(
        isUrdu: isUrdu,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpace.gutter,
              0,
              AppSpace.gutter,
              AppSpace.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title ?? tr('Contact Support'), style: AppText.h2),
                const SizedBox(height: 4),
                Text(
                  tr('Choose how you want to contact us.'),
                  style: AppText.small,
                ),
                const SizedBox(height: AppSpace.lg),
                if (contact.phone.isNotEmpty)
                  option(
                    icon: Icons.call_outlined,
                    label: tr('Call'),
                    value: contact.phone,
                    onTap: () => run(() => SupportContact.dial(contact.phone)),
                  ),
                if (contact.whatsapp.isNotEmpty)
                  option(
                    icon: Icons.chat_outlined,
                    label: tr('WhatsApp'),
                    value: contact.whatsapp,
                    onTap: () => run(
                      () => SupportContact.openWhatsApp(contact.whatsapp),
                    ),
                  ),
                if (contact.email.isNotEmpty)
                  option(
                    icon: Icons.email_outlined,
                    label: tr('Email'),
                    value: contact.email,
                    onTap: () =>
                        run(() => SupportContact.sendEmail(contact.email)),
                  ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
