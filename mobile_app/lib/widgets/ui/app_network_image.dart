import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';

/// Network image with disk + memory caching, decode sized to the display
/// size, and a neutral tile + green icon while loading or when it fails.
class AppNetworkImage extends StatelessWidget {
  final String? url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;
  final IconData placeholderIcon;
  final Alignment alignment;

  const AppNetworkImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.placeholderIcon = Icons.storefront_outlined,
    this.alignment = Alignment.center,
  });

  @override
  Widget build(BuildContext context) {
    final cleanUrl = (url ?? '').trim();
    Widget child;
    if (cleanUrl.isEmpty) {
      child = ImagePlaceholder(icon: placeholderIcon);
    } else {
      child = LayoutBuilder(
        builder: (context, constraints) {
          final dpr = MediaQuery.devicePixelRatioOf(context);
          final w = width ??
              (constraints.hasBoundedWidth ? constraints.maxWidth : null);
          final h = height ??
              (constraints.hasBoundedHeight ? constraints.maxHeight : null);
          // Decode at display size; only constrain one side so the aspect
          // ratio is kept.
          final int? cacheW = w != null && w.isFinite
              ? (w * dpr).round().clamp(1, 2000)
              : null;
          final int? cacheH = cacheW == null && h != null && h.isFinite
              ? (h * dpr).round().clamp(1, 2000)
              : null;
          return CachedNetworkImage(
            imageUrl: cleanUrl,
            width: w,
            height: h,
            fit: fit,
            alignment: alignment,
            memCacheWidth: cacheW,
            memCacheHeight: cacheH,
            fadeInDuration: const Duration(milliseconds: 150),
            fadeOutDuration: Duration.zero,
            placeholder: (_, _) => ImagePlaceholder(icon: placeholderIcon),
            errorWidget: (_, _, _) => ImagePlaceholder(icon: placeholderIcon),
          );
        },
      );
    }

    if (width != null || height != null) {
      child = SizedBox(width: width, height: height, child: child);
    }
    if (borderRadius != null) {
      child = ClipRRect(borderRadius: borderRadius!, child: child);
    }
    return child;
  }
}

/// Neutral tile with a green icon, used while images load or fail.
class ImagePlaceholder extends StatelessWidget {
  final IconData icon;

  const ImagePlaceholder({super.key, this.icon = Icons.image_outlined});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface3,
      alignment: Alignment.center,
      child: LayoutBuilder(
        builder: (context, c) {
          final shortest = c.biggest.shortestSide;
          final size = shortest.isFinite
              ? (shortest * 0.32).clamp(16.0, 44.0)
              : 28.0;
          return Icon(icon, size: size, color: AppColors.primary);
        },
      ),
    );
  }
}
