import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import 'cards.dart';

//// Left-to-right shimmer for skeleton content.
///
/// One [AnimationController] and one [ShaderMask] for the whole skeleton:
/// the [SkeletonBox]es underneath are plain, never-rebuilt grey blocks and a
/// translucent highlight band is swept over all of them at once. Per frame
/// only the mask's shader changes; no child widget rebuilds.
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

  static const List<Color> _band = [
    Color(0x00FFFFFF),
    Color(0x99FFFFFF),
    Color(0x00FFFFFF),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        // Built once; only the ShaderMask below is rebuilt each frame.
        child: widget.child,
        builder: (context, child) {
          final t = _controller.value * 3 - 1; // -1 .. 2
          return ShaderMask(
            blendMode: BlendMode.srcATop,
            shaderCallback: (bounds) => LinearGradient(
              begin: Alignment(-1 + 2 * (t - 0.5), 0),
              end: Alignment(-1 + 2 * (t + 0.5), 0),
              colors: _band,
              stops: const [0.0, 0.5, 1.0],
            ).createShader(bounds),
            child: child,
          );
        },
      ),
    );
  }
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

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: _base,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// Skeleton of one [StoreCard.compact] row.
class SkeletonStoreRow extends StatelessWidget {
  const SkeletonStoreRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: StoreCard.compactExtent,
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        children: [
          SkeletonBox(width: 78, height: 78, radius: AppRadius.control),
          SizedBox(width: AppSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SkeletonBox(width: 160, height: 16),
                SizedBox(height: AppSpace.sm),
                SkeletonBox(width: 110, height: 12),
                SizedBox(height: AppSpace.sm),
                SkeletonBox(width: 140, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Skeleton shaped like a list of cards (image + two text lines).
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
