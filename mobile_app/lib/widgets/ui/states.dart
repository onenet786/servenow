import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_text.dart';

/// Friendly empty / error / guest state with one clear action.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? actionIcon;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final bool isError;
  final bool compact;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.actionIcon,
    this.secondaryLabel,
    this.onSecondary,
    this.isError = false,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final accent = isError ? AppColors.danger : AppColors.primary;
    final accentBg = isError ? AppColors.dangerBg : AppColors.tint100;
    return Center(
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: AppSpace.xxl,
          vertical: compact ? AppSpace.lg : AppSpace.xxxl,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: compact ? 56 : 72,
                height: compact ? 56 : 72,
                decoration: BoxDecoration(
                  color: accentBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: accent, size: compact ? 28 : 34),
              ),
              const SizedBox(height: AppSpace.lg),
              Text(
                title,
                textAlign: TextAlign.center,
                style: AppText.title.copyWith(fontSize: 17),
              ),
              if (message != null && message!.trim().isNotEmpty) ...[
                const SizedBox(height: AppSpace.sm),
                Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: AppText.bodySecondary,
                ),
              ],
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: AppSpace.xl),
                FilledButton.icon(
                  onPressed: onAction,
                  icon: Icon(actionIcon ?? Icons.arrow_forward_rounded),
                  label: Text(actionLabel!),
                ),
              ],
              if (secondaryLabel != null && onSecondary != null) ...[
                const SizedBox(height: AppSpace.xs),
                TextButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Section title with optional subtitle and trailing action.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.fromLTRB(
      AppSpace.gutter,
      AppSpace.xl,
      AppSpace.gutter,
      AppSpace.md,
    ),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(title, style: AppText.h2),
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: AppText.small),
                ],
              ],
            ),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ),
    );
  }
}

/// Label / value row with an optional leading icon.
class InfoRow extends StatelessWidget {
  final IconData? icon;
  final String label;
  final String value;
  final bool emphasize;
  final Color? valueColor;
  final int maxLines;

  const InfoRow({
    super.key,
    this.icon,
    required this.label,
    required this.value,
    this.emphasize = false,
    this.valueColor,
    this.maxLines = 3,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(icon, size: 18, color: AppColors.muted),
            ),
            const SizedBox(width: AppSpace.sm),
          ],
          Expanded(
            flex: 4,
            child: Text(label, style: AppText.small),
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            flex: 6,
            child: Text(
              value,
              textAlign: TextAlign.end,
              maxLines: maxLines,
              overflow: TextOverflow.ellipsis,
              style: (emphasize ? AppText.title : AppText.bodyStrong).copyWith(
                color: valueColor,
                fontFeatures: AppText.tabular,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// White card with a 1px border and 16 radius - the base surface.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? borderColor;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpace.lg),
    this.onTap,
    this.color,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color ?? AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.cardAll,
        side: BorderSide(color: borderColor ?? AppColors.border),
      ),
      clipBehavior: onTap != null ? Clip.antiAlias : Clip.none,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
