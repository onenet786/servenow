import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_text.dart';

/// Start-up screen shown while auto-login runs. The logo is a bundled asset
/// drawn on the very first frame (no network, no blobs, no fade-in), with a
/// small green progress indicator below it.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final logo = (width * 0.34).clamp(96.0, 148.0);
    final dpr = MediaQuery.devicePixelRatioOf(context);

    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(logo * 0.22),
                child: Image.asset(
                  'assets/icon/servenow_brand_logo_v2.png',
                  width: logo,
                  height: logo,
                  cacheWidth: (logo * dpr).round(),
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  frameBuilder: (ctx, child, frame, wasSync) =>
                      frame == null && !wasSync
                      ? Container(
                          width: logo,
                          height: logo,
                          color: AppColors.tint100,
                          alignment: Alignment.center,
                          child: const Icon(
                            Icons.shopping_basket_rounded,
                            color: AppColors.primary,
                            size: 44,
                          ),
                        )
                      : child,
                  errorBuilder: (ctx, err, stack) => Container(
                    width: logo,
                    height: logo,
                    color: AppColors.primary,
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.shopping_cart_outlined,
                      color: Colors.white,
                      size: 48,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'ServeNow',
                textDirection: TextDirection.ltr,
                style: TextStyle(
                  fontFamily: AppText.latinFamily,
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                  color: AppColors.text,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Groceries, food & more',
                textDirection: TextDirection.ltr,
                style: TextStyle(
                  fontFamily: AppText.latinFamily,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.text2,
                ),
              ),
              const SizedBox(height: 32),
              const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.6,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
