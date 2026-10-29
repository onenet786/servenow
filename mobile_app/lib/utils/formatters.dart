import 'package:intl/intl.dart';

/// Display formatting shared by every screen: money, dates, times, payment
/// methods, delivery-time choices and bidi isolation for mixed Urdu/Latin.
///
/// Pure functions only - no business logic.
class Fmt {
  Fmt._();

  static final NumberFormat _whole = NumberFormat('#,##0', 'en_US');
  static final NumberFormat _decimal = NumberFormat('#,##0.00', 'en_US');

  /// Unicode "left-to-right isolate" / "pop directional isolate". Wrapping a
  /// Latin or numeric run in these keeps it intact inside RTL Urdu text.
  static const String lri = '\u2066';
  static const String pdi = '\u2069';

  static String isolate(String text) => '$lri$text$pdi';

  /// True when [text] has at least as many Latin letters as Arabic-script
  /// ones (an English store/product name or description shown in Urdu mode).
  static bool isMostlyLatin(String text) {
    var latin = 0;
    var arabic = 0;
    for (final rune in text.runes) {
      if ((rune >= 0x41 && rune <= 0x5A) || (rune >= 0x61 && rune <= 0x7A)) {
        latin++;
      } else if (rune >= 0x0600 && rune <= 0x06FF) {
        arabic++;
      }
    }
    return latin > 0 && latin >= arabic;
  }

  static double toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString().replaceAll(',', '').trim()) ?? 0;
  }

  /// `1160` -> `1,160`; `840.5` -> `840.50`.
  static String number(dynamic value) {
    final v = toDouble(value);
    final rounded = (v * 100).roundToDouble() / 100;
    if (rounded == rounded.truncateToDouble()) return _whole.format(rounded);
    return _decimal.format(rounded);
  }

  /// `Rs 1,160`. Pass [urdu] to get the Urdu currency word while keeping the
  /// digits left-to-right.
  static String money(dynamic value, {bool urdu = false, String? currency}) {
    final amount = number(value);
    if (urdu) return isolate('${currency ?? 'Rs'} $amount');
    return '${currency ?? 'Rs'} $amount';
  }

  /// Parses ISO strings, `yyyy-MM-dd HH:mm:ss`, epoch millis; returns local.
  static DateTime? parseDate(dynamic raw) {
    if (raw == null) return null;
    if (raw is DateTime) return raw.toLocal();
    if (raw is int) {
      return DateTime.fromMillisecondsSinceEpoch(raw).toLocal();
    }
    final text = raw.toString().trim();
    if (text.isEmpty) return null;
    final parsed = DateTime.tryParse(text) ??
        DateTime.tryParse(text.replaceFirst(' ', 'T'));
    return parsed?.toLocal();
  }

  /// `28 Oct, 8:38 PM` (adds the year when it is not the current year).
  static String dateTime(dynamic raw, {String fallback = ''}) {
    final d = parseDate(raw);
    if (d == null) return fallback;
    final now = DateTime.now();
    final pattern = d.year == now.year ? 'd MMM, h:mm a' : 'd MMM yyyy, h:mm a';
    return DateFormat(pattern, 'en_US').format(d);
  }

  /// `28 Oct 2026`.
  static String date(dynamic raw, {String fallback = ''}) {
    final d = parseDate(raw);
    if (d == null) return fallback;
    return DateFormat('d MMM yyyy', 'en_US').format(d);
  }

  /// `8:38 PM`.
  static String time(dynamic raw, {String fallback = ''}) {
    final d = parseDate(raw);
    if (d == null) return fallback;
    return DateFormat('h:mm a', 'en_US').format(d);
  }

  /// `23:00` / `23:00:00` -> `11:00 PM`. Returns the input when unparseable.
  static String clock(String? hhmm) {
    final text = (hhmm ?? '').trim();
    if (text.isEmpty) return '';
    final match = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(text);
    if (match == null) return text;
    final h = int.parse(match.group(1)!);
    final m = int.parse(match.group(2)!);
    if (h > 23 || m > 59) return text;
    final period = h >= 12 ? 'PM' : 'AM';
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '$h12:${m.toString().padLeft(2, '0')} $period';
  }

  /// `12:00 PM - 11:00 PM`.
  static String hours(String? open, String? close) {
    final a = clock(open);
    final b = clock(close);
    if (a.isEmpty && b.isEmpty) return '';
    if (a.isEmpty) return b;
    if (b.isEmpty) return a;
    return '$a \u2013 $b';
  }

  /// Cleans free-text delivery-time values such as `35 Minute min`,
  /// `30 minute min`, `45-50 Minutes` into `35 min`, `45-50 min`.
  static String eta(dynamic raw) {
    final text = (raw ?? '').toString().trim();
    if (text.isEmpty) return '';
    final range = RegExp(r'(\d+)\s*(?:-|\u2013|to)\s*(\d+)').firstMatch(text);
    if (range != null) return '${range.group(1)}\u2013${range.group(2)} min';
    final single = RegExp(r'(\d+)').firstMatch(text);
    if (single != null) {
      final lower = text.toLowerCase();
      if (lower.contains('hour') || lower.contains('hr')) {
        return '${single.group(1)} hr';
      }
      return '${single.group(1)} min';
    }
    return text;
  }

  /// Raw payment method -> customer label.
  static String paymentMethod(dynamic raw) {
    final value = (raw ?? '').toString().trim().toLowerCase();
    switch (value) {
      case 'cash':
      case 'cod':
      case 'cash_on_delivery':
        return 'Cash on delivery';
      case 'card':
      case 'stripe':
      case 'credit_card':
        return 'Card';
      case 'wallet':
        return 'Wallet';
      case '':
        return '';
      default:
        return _title(value.replaceAll('_', ' '));
    }
  }

  static bool isCashPayment(dynamic raw) {
    final value = (raw ?? '').toString().trim().toLowerCase();
    return value.isEmpty ||
        value == 'cash' ||
        value == 'cod' ||
        value == 'cash_on_delivery';
  }

  /// Raw preferred delivery time (`asap`, `1hour`, ...) -> label.
  static String deliveryTime(dynamic raw) {
    final value = (raw ?? '').toString().trim();
    final lower = value.toLowerCase();
    if (lower.isEmpty) return '';
    if (lower == 'asap') return 'As soon as possible';
    if (lower == '1hour' || lower == '1_hour' || lower == 'within_1_hour') {
      return 'Within 1 hour';
    }
    if (lower == '2hours' || lower == '2_hours' || lower == 'within_2_hours') {
      return 'Within 2 hours';
    }
    if (lower == 'tomorrow') return 'Tomorrow';
    final asDate = parseDate(value);
    if (asDate != null) return dateTime(asDate);
    return _title(value.replaceAll('_', ' '));
  }

  static String _title(String text) {
    if (text.isEmpty) return text;
    return text
        .split(' ')
        .where((w) => w.isNotEmpty)
        .map((w) => w[0].toUpperCase() + w.substring(1))
        .join(' ');
  }

  /// `Ord2610280020` / `ORD-…` -> `#Ord2610280020` without doubling "Order".
  static String orderNumber(dynamic raw, {dynamic fallbackId}) {
    final text = (raw ?? '').toString().trim();
    if (text.isNotEmpty) return '#$text';
    final id = (fallbackId ?? '').toString().trim();
    return id.isEmpty ? '' : '#$id';
  }

  /// Variant / unit labels for display: `1Piece` -> `1 Piece`,
  /// `250Grams` -> `250 Grams`, `Default` -> empty.
  static String unit(String? raw) {
    final text = (raw ?? '').trim();
    if (text.isEmpty || text.toLowerCase() == 'default') return '';
    return text.replaceAllMapped(
      RegExp(r'(\d)([A-Za-z])'),
      (m) => '${m.group(1)} ${m.group(2)}',
    );
  }

  /// `1 item` / `3 items`.
  static String count(int n, String singular, [String? plural]) {
    return '$n ${n == 1 ? singular : (plural ?? '${singular}s')}';
  }
}
