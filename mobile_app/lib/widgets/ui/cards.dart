import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_text.dart';
import 'app_network_image.dart';
import 'bidi_text.dart';
import 'status_pill.dart';

/// Store card: 16:9 image, name, area, rating, ETA, delivery fee, open state.
///
/// [StoreCard.compact] is the row variant for vertical lists (Home "All
/// stores", Stores tab): a 76 px logo tile shown whole on the start side and
/// the text on the end side, [compactExtent] tall, so 5-6 stores fit on a
/// phone screen instead of 1.3. Most store "images" are square logos, which
/// the 16:9 card crops; the row never crops them.
class StoreCard extends StatelessWidget {
  final String name;
  final String? subtitle;
  final String? imageUrl;
  final bool isOpen;
  final String? rating;
  final String? eta;
  final String? deliveryFee;
  final String? badge;
  final VoidCallback? onTap;
  final String openLabel;
  final String closedLabel;
  final String? closedNote;

  const StoreCard({
    super.key,
    required this.name,
    this.subtitle,
    this.imageUrl,
    this.isOpen = true,
    this.rating,
    this.eta,
    this.deliveryFee,
    this.badge,
    this.onTap,
    this.openLabel = 'Open',
    this.closedLabel = 'Closed',
    this.closedNote,
  }) : compact = false;

  const StoreCard.compact({
    super.key,
    required this.name,
    this.subtitle,
    this.imageUrl,
    this.isOpen = true,
    this.rating,
    this.eta,
    this.deliveryFee,
    this.badge,
    this.onTap,
    this.openLabel = 'Open',
    this.closedLabel = 'Closed',
    this.closedNote,
  }) : compact = true;

  final bool compact;

  /// Height of one [StoreCard.compact] row (fixed, so lists can use it as
  /// their item extent).
  static const double compactExtent = 104;

  @override
  Widget build(BuildContext context) {
    final meta = <Widget>[
      if (rating != null && rating!.isNotEmpty)
        _Meta(
          icon: Icons.star_rounded,
          text: rating!,
          iconColor: AppColors.star,
        ),
      if (eta != null && eta!.isNotEmpty)
        _Meta(icon: Icons.schedule_rounded, text: eta!),
      if (deliveryFee != null && deliveryFee!.isNotEmpty)
        _Meta(icon: Icons.delivery_dining_outlined, text: deliveryFee!),
    ];

    if (compact) return _buildCompact(meta);

    return Semantics(
      button: onTap != null,
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    AppNetworkImage(url: imageUrl, fit: BoxFit.cover),
                    if (!isOpen) const ColoredBox(color: Color(0x66FFFFFF)),
                    PositionedDirectional(
                      top: AppSpace.sm,
                      start: AppSpace.sm,
                      child: OpenBadge(
                        isOpen: isOpen,
                        openLabel: openLabel,
                        closedLabel: closedLabel,
                      ),
                    ),
                    if (badge != null && badge!.isNotEmpty)
                      PositionedDirectional(
                        top: AppSpace.sm,
                        end: AppSpace.sm,
                        child: TonePill.warning(
                          badge!,
                          icon: Icons.local_offer_outlined,
                        ),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.md,
                  AppSpace.md,
                  AppSpace.md,
                  AppSpace.md,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    BidiText(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      BidiText(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                    ],
                    if (!isOpen &&
                        closedNote != null &&
                        closedNote!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        closedNote!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption.copyWith(
                          color: AppColors.warning,
                        ),
                      ),
                    ],
                    if (meta.isNotEmpty) ...[
                      const SizedBox(height: AppSpace.sm),
                      Wrap(spacing: AppSpace.md, runSpacing: 4, children: meta),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

extension on StoreCard {
  Widget _buildCompact(List<Widget> meta) {
    final hasBadge = badge != null && badge!.isNotEmpty;
    return Semantics(
      button: onTap != null,
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: StoreCard.compactExtent,
            child: Padding(
              padding: const EdgeInsets.all(AppSpace.md),
              child: Row(
                children: [
                  SizedBox.square(
                    dimension: 78,
                    child: ClipRRect(
                      borderRadius: AppRadius.controlAll,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          const ColoredBox(color: AppColors.surface2),
                          Padding(
                            padding: const EdgeInsets.all(4),
                            child: AppNetworkImage(
                              url: imageUrl,
                              fit: BoxFit.contain,
                            ),
                          ),
                          if (!isOpen)
                            const ColoredBox(color: Color(0x80FFFFFF)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: BidiText(
                                name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.title,
                              ),
                            ),
                            const SizedBox(width: AppSpace.sm),
                            OpenBadge(
                              isOpen: isOpen,
                              openLabel: openLabel,
                              closedLabel: closedLabel,
                            ),
                          ],
                        ),
                        if (!isOpen &&
                            closedNote != null &&
                            closedNote!.isNotEmpty)
                          Text(
                            closedNote!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.caption.copyWith(
                              color: AppColors.warning,
                            ),
                          )
                        else if (subtitle != null && subtitle!.isNotEmpty)
                          BidiText(
                            subtitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.small,
                          ),
                        if (meta.isNotEmpty || hasBadge) ...[
                          const SizedBox(height: AppSpace.xs),
                          // One line: meta that does not fit is clipped,
                          // never wrapped, so every row has the same height.
                          SizedBox(
                            height: 22,
                            child: ClipRect(
                              child: OverflowBox(
                                alignment: AlignmentDirectional.centerStart,
                                maxWidth: double.infinity,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    for (final m in meta) ...[
                                      m,
                                      const SizedBox(width: AppSpace.md),
                                    ],
                                    if (hasBadge)
                                      _Meta(
                                        icon: Icons.local_offer_outlined,
                                        text: badge!,
                                        iconColor: AppColors.warning,
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color? iconColor;

  const _Meta({required this.icon, required this.text, this.iconColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: iconColor ?? AppColors.muted),
        const SizedBox(width: 3),
        Text(
          text,
          style: AppText.caption.copyWith(
            color: AppColors.text2,
            fontWeight: FontWeight.w600,
            fontFeatures: AppText.tabular,
          ),
        ),
      ],
    );
  }
}

/// Product tile for store menus: image, name, unit/option hint, price and an
/// action area (ADD button or quantity stepper) supplied by the caller.
class ProductCard extends StatelessWidget {
  final String name;
  final String? imageUrl;
  final Widget price;
  final String? hint;
  final String? badge;
  final Widget action;
  final VoidCallback? onTap;
  final bool dimmed;

  const ProductCard({
    super.key,
    required this.name,
    required this.price,
    required this.action,
    this.imageUrl,
    this.hint,
    this.badge,
    this.onTap,
    this.dimmed = false,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AspectRatio(
                aspectRatio: 4 / 3,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    AppNetworkImage(
                      url: imageUrl,
                      placeholderIcon: Icons.fastfood_outlined,
                    ),
                    if (dimmed) const ColoredBox(color: Color(0x80FFFFFF)),
                    if (badge != null && badge!.isNotEmpty)
                      PositionedDirectional(
                        top: AppSpace.sm,
                        start: AppSpace.sm,
                        child: TonePill.warning(badge!),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      BidiText(
                        name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        latinHeight: 1.25,
                        style: AppText.bodyStrong.copyWith(height: 1.25),
                      ),
                      // Price and unit on one line right under the name;
                      // the ADD button / stepper gets its own full-width row
                      // at the bottom, so a 48 dp stepper never squeezes the
                      // price to "Rs…".
                      const SizedBox(height: AppSpace.xs),
                      Row(
                        children: [
                          Flexible(child: price),
                          if (hint != null && hint!.isNotEmpty) ...[
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                hint!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.caption,
                              ),
                            ),
                          ],
                        ],
                      ),
                      const Spacer(),
                      // Own semantics node, so ADD / the stepper stay
                      // separately focusable inside the tappable card.
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Semantics(container: true, child: action),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
