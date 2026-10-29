import 'package:flutter/material.dart';

import '../../utils/formatters.dart';

/// Text that follows its *own* script direction instead of the screen's.
///
/// Store, product and customer names are usually English. Inside an Urdu
/// (RTL) screen a plain [Text] lays them out as an RTL paragraph: the
/// ellipsis lands on the left ("…Pakeeza Hotel, King Burger, S") and the
/// line inherits Nastaliq's 1.85 line height. [BidiText] renders Latin text
/// as an LTR paragraph, still aligned to the RTL reading start (right), with
/// a Latin line height. Urdu text, and anything on an English screen, is
/// rendered exactly like a normal [Text].
class BidiText extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;
  final double latinHeight;

  const BidiText(
    this.text, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
    this.latinHeight = 1.3,
  });

  @override
  Widget build(BuildContext context) {
    final rtl = Directionality.of(context) == TextDirection.rtl;
    if (!rtl || !Fmt.isMostlyLatin(text)) {
      return Text(text, style: style, maxLines: maxLines, overflow: overflow);
    }
    return Text(
      text,
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.right,
      style: (style ?? const TextStyle()).copyWith(height: latinHeight),
      maxLines: maxLines,
      overflow: overflow,
    );
  }
}
