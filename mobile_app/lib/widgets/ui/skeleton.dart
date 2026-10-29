import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';

/// Left-to-right shimmer for skeleton content. One animation drives every
/// [SkeletonBox] below it, inside one [RepaintBoundary] (no Opacity layers).
class Shimmer extends StatefulWidget {
  final Widget child;

  const Shimmer({super.key, required this.child});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: _ShimmerScope(animation: _controller, child: widget.child),
    );
  }
}

class _ShimmerScope extends InheritedWidget {
  final Animation<double> animation;

  const _ShimmerScope({required this.animation, required super.child});

  static Animation<double>? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_ShimmerScope>()?.animation;

  @override
  bool updateShouldNotify(_ShimmerScope oldWidget) =>
      oldWidget.animation != animation;
}

/// A grey rounded block. Shimmers when placed inside a [Shimmer].
class SkeletonBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;

  const SkeletonBox({
    super.key,
    this.width,
    this.height = 14,
    this.radius = AppRadius.small,
  });

  static const Color _base = Color(0xFFE9EBEF);
  static const Color _highlight = Color(0xFFF6F7F9);

  @override
  Widget build(BuildContext context) {
    final animation = _ShimmerScope.of(context);
    final shape = BorderRadius.circular(radius);
    if (animation == null) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(color: _base, borderRadius: shape),
      );
    }
    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) {
        final t = animation.value * 3 - 1; // -1 .. 2
        return Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            borderRadius: shape,
            gradient: LinearGradient(
              begin: Alignment(-1 + 2 * (t - 0.5), 0),
              end: Alignment(-1 + 2 * (t + 0.5), 0),
              colors: const [_base, _highlight, _base],
              stops: const [0.0, 0.5, 1.0],
            ),
          ),
        );
      },
    );
  }
}

/// Skeleton shaped like a list of cards (image + two text lines).
class SkeletonList extends StatelessWidget {
  final int count;
  final double imageHeight;
  final EdgeInsetsGeometry padding;
  final bool shrinkWrap;

  const SkeletonList({
    super.key,
    this.count = 4,
    this.imageHeight = 0,
    this.padding = const EdgeInsets.all(AppSpace.gutter),
    this.shrinkWrap = false,
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        padding: padding,
        shrinkWrap: shrinkWrap,
        physics: shrinkWrap
            ? const NeverScrollableScrollPhysics()
            : const AlwaysScrollableScrollPhysics(),
        itemCount: count,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpace.md),
        itemBuilder: (_, _) => SkeletonCard(imageHeight: imageHeight),
      ),
    );
  }
}

/// One card-shaped skeleton.
class SkeletonCard extends StatelessWidget {
  final double imageHeight;

  const SkeletonCard({super.key, this.imageHeight = 0});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (imageHeight > 0) ...[
            SkeletonBox(height: imageHeight, radius: AppRadius.control),
            const SizedBox(height: AppSpace.md),
          ],
          const SkeletonBox(width: 180, height: 16),
          const SizedBox(height: AppSpace.sm),
          const SkeletonBox(width: 120, height: 12),
          const SizedBox(height: AppSpace.sm),
          const Row(
            children: [
              SkeletonBox(width: 64, height: 22, radius: 999),
              SizedBox(width: AppSpace.sm),
              SkeletonBox(width: 64, height: 22, radius: 999),
            ],
          ),
        ],
      ),
    );
  }
}
