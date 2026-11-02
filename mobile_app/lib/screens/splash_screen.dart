import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// The logo's own colours, sampled from images/servenow_brand_logo.png.
// `_cream` is also `launch_background` in the Android colours, so the native
// launch screen hands over to this one with no flash.
const _cream = Color(0xFFFBF6EE);
const _blush = Color(0xFFDBBEA1);
const _brown = Color(0xFF582B15);
const _copper = Color(0xFFC9844B);
const _gold = Color(0xFFEBC191);

const _badgeAsset = AssetImage('assets/splash/badge.png');
const _wordmarkAsset = AssetImage('assets/splash/wordmark.png');
const _taglineAsset = AssetImage('assets/splash/tagline.png');

/// Size of the badge on Android's launch screen, in dp. The animation starts
/// from this size at the middle of the screen, so the two line up.
const _nativeBadgeSize = 192.0;

const _introLength = Duration(milliseconds: 1700);
const _orbitLength = Duration(milliseconds: 1500);

/// Start-up screen shown while auto-login runs. The badge rises from where the
/// native launch screen left it, the name wipes in beneath it, and a copper
/// arc circles the badge as the loader until the app is ready.
///
/// [onIntroDone] fires once the intro has played, so the app can wait for it.
/// With system animations turned off it fires at once and nothing moves.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.onIntroDone});

  final VoidCallback? onIntroDone;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: _introLength,
  );
  late final AnimationController _orbit = AnimationController(
    vsync: this,
    duration: _orbitLength,
  );
  bool _started = false;
  bool _holdingFirstFrame = false;

  @override
  void initState() {
    super.initState();
    // Keeps the native launch screen up until the artwork is decoded, so the
    // badge never blinks out between the two.
    final binding = WidgetsBinding.instance;
    if (!binding.firstFrameRasterized) {
      binding.deferFirstFrame();
      _holdingFirstFrame = true;
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    Future.wait([
      for (final asset in const [_badgeAsset, _wordmarkAsset, _taglineAsset])
        precacheImage(asset, context, onError: (_, _) {}),
    ]).whenComplete(_begin);
  }

  void _begin() {
    _releaseFirstFrame();
    if (!mounted) return;
    if (MediaQuery.disableAnimationsOf(context)) {
      _intro.value = 1;
      widget.onIntroDone?.call();
      return;
    }
    _orbit.repeat();
    _intro.forward().whenCompleteOrCancel(() {
      if (mounted) widget.onIntroDone?.call();
    });
  }

  void _releaseFirstFrame() {
    if (!_holdingFirstFrame) return;
    _holdingFirstFrame = false;
    WidgetsBinding.instance.allowFirstFrame();
  }

  @override
  void dispose() {
    _releaseFirstFrame();
    _intro.dispose();
    _orbit.dispose();
    super.dispose();
  }

  /// Progress of the part of the intro between [begin] and [end].
  double _at(double begin, double end, [Curve curve = Curves.linear]) {
    final t = ((_intro.value - begin) / (end - begin)).clamp(0.0, 1.0);
    return curve.transform(t);
  }

  @override
  Widget build(BuildContext context) {
    final still = MediaQuery.disableAnimationsOf(context);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: _cream,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: _cream,
        body: Semantics(
          label: 'ServeNow is loading',
          child: LayoutBuilder(
            builder: (context, box) {
              final width = box.maxWidth;
              final height = box.maxHeight;
              final badgeSize = math.min(width * 0.56, height * 0.3);
              final restY = height * 0.4;
              final wordmarkWidth = math.min(width * 0.6, 270.0);
              final taglineWidth = math.min(width * 0.74, 330.0);

              return AnimatedBuilder(
                animation: Listenable.merge([_intro, _orbit]),
                child: const _Badge(),
                builder: (context, badge) {
                  final rise = _at(0.04, 0.5, Curves.easeInOutCubic);
                  final grow = _at(0.04, 0.5, Curves.easeOutBack);
                  final settled = _at(0.5, 0.9);
                  final bob =
                      math.sin(_orbit.value * 2 * math.pi) * 3 * settled;
                  final centreY =
                      height / 2 + (restY - height / 2) * rise + bob;
                  final startScale = _nativeBadgeSize / badgeSize;
                  final scale = startScale + (1 - startScale) * grow;
                  final textTop = restY + badgeSize * 0.5 + badgeSize * 0.34;
                  final wipe = _at(0.36, 0.72, Curves.easeOutCubic);
                  final tagline = _at(0.58, 0.9, Curves.easeOut);

                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      CustomPaint(
                        painter: _BackdropPainter(
                          glow: _at(0, 0.6, Curves.easeOut),
                        ),
                      ),
                      if (!still)
                        CustomPaint(
                          painter: _SparklePainter(
                            centre: Offset(width / 2, centreY),
                            radius: badgeSize * 0.5,
                            turn: _orbit.value,
                            opacity: _at(0.3, 0.8),
                          ),
                        ),
                      Positioned(
                        left: 0,
                        right: 0,
                        top: restY + badgeSize * 0.5 + badgeSize * 0.17,
                        child: Center(
                          child: _GroundShadow(
                            width: badgeSize * (0.68 - bob * 0.008),
                            opacity: rise * 0.55,
                          ),
                        ),
                      ),
                      Positioned(
                        left: width / 2 - badgeSize * 0.68,
                        top: centreY - badgeSize * 0.68,
                        width: badgeSize * 1.36,
                        height: badgeSize * 1.36,
                        child: CustomPaint(
                          painter: _OrbitPainter(
                            badgeRadius: badgeSize * 0.5,
                            ripple: _at(0.1, 0.62, Curves.easeOut),
                            turn: _orbit.value,
                            opacity: still ? 1 : _at(0.34, 0.6, Curves.easeOut),
                          ),
                          child: Center(
                            child: Transform.scale(
                              scale: scale,
                              child: SizedBox.square(
                                dimension: badgeSize,
                                child: CustomPaint(
                                  foregroundPainter: _SheenPainter(
                                    progress: _at(0.4, 0.8, Curves.easeInOut),
                                  ),
                                  child: badge,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        top: textTop,
                        child: Column(
                          children: [
                            Transform.translate(
                              offset: Offset(0, 10 * (1 - wipe)),
                              child: _WipeIn(
                                progress: wipe,
                                child: Image(
                                  image: _wordmarkAsset,
                                  width: wordmarkWidth,
                                  gaplessPlayback: true,
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Opacity(
                              opacity: tagline,
                              child: Transform.translate(
                                offset: Offset(0, 8 * (1 - tagline)),
                                child: Image(
                                  image: _taglineAsset,
                                  width: taglineWidth,
                                  gaplessPlayback: true,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge();

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: DecoratedBox(
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Color(0x33582B15),
              blurRadius: 30,
              offset: Offset(0, 14),
            ),
          ],
        ),
        child: Image(
          image: _badgeAsset,
          fit: BoxFit.contain,
          gaplessPlayback: true,
          errorBuilder: (ctx, err, stack) => const DecoratedBox(
            decoration: BoxDecoration(shape: BoxShape.circle, color: _copper),
            child: Icon(
              Icons.shopping_cart_outlined,
              color: Colors.white,
              size: 56,
            ),
          ),
        ),
      ),
    );
  }
}

/// The soft shadow under the badge, as in the logo.
class _GroundShadow extends StatelessWidget {
  const _GroundShadow({required this.width, required this.opacity});

  final double width;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: opacity.clamp(0.0, 1.0),
      child: Container(
        width: width,
        height: 14,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.all(Radius.elliptical(width / 2, 7)),
          gradient: RadialGradient(
            colors: [
              _brown.withValues(alpha: 0.42),
              _brown.withValues(alpha: 0),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reveals its child from left to right along a soft edge.
class _WipeIn extends StatelessWidget {
  const _WipeIn({required this.progress, required this.child});

  final double progress;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.dstIn,
      shaderCallback: (bounds) {
        final edge = progress * 1.3;
        return LinearGradient(
          colors: const [Colors.white, Colors.white, Colors.transparent],
          stops: [0, (edge - 0.3).clamp(0.0, 1.0), edge.clamp(0.0, 1.0)],
        ).createShader(bounds);
      },
      child: child,
    );
  }
}

/// The warm corners of the logo's background.
class _BackdropPainter extends CustomPainter {
  const _BackdropPainter({required this.glow});

  final double glow;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final reach = size.longestSide * 0.62;
    for (final corner in [rect.topRight, rect.bottomLeft]) {
      final paint = Paint()
        ..shader = RadialGradient(
          colors: [
            _blush.withValues(alpha: 0.75 * glow),
            _blush.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: corner, radius: reach));
      canvas.drawRect(rect, paint);
    }
  }

  @override
  bool shouldRepaint(_BackdropPainter old) => old.glow != glow;
}

/// The loader: a copper arc with a bright head circling the badge, plus the
/// two rings that spread out once as the badge arrives.
class _OrbitPainter extends CustomPainter {
  const _OrbitPainter({
    required this.badgeRadius,
    required this.ripple,
    required this.turn,
    required this.opacity,
  });

  final double badgeRadius;
  final double ripple;
  final double turn;
  final double opacity;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final radius = badgeRadius * 1.16;

    for (final delay in const [0.0, 0.26]) {
      final t = ((ripple - delay) / (1 - delay)).clamp(0.0, 1.0);
      if (t <= 0 || t >= 1) continue;
      canvas.drawCircle(
        centre,
        badgeRadius * (1 + 0.34 * t),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5 * (1 - t) + 0.5
          ..color = _copper.withValues(alpha: 0.5 * (1 - t)),
      );
    }

    if (opacity <= 0) return;
    canvas.drawCircle(
      centre,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = _gold.withValues(alpha: 0.35 * opacity),
    );

    const sweep = math.pi * 1.35;
    final head = turn * 2 * math.pi - math.pi / 2;
    final tail = head - sweep;
    final arc = Rect.fromCircle(center: centre, radius: radius);
    canvas.drawArc(
      arc,
      tail,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.5
        ..strokeCap = StrokeCap.round
        ..shader = SweepGradient(
          transform: GradientRotation(tail),
          endAngle: sweep,
          colors: [
            _copper.withValues(alpha: 0),
            _copper.withValues(alpha: opacity),
            _brown.withValues(alpha: opacity),
          ],
          stops: const [0, 0.65, 1],
        ).createShader(arc),
    );

    final tip = centre + Offset(math.cos(head), math.sin(head)) * radius;
    canvas.drawCircle(
      tip,
      9,
      Paint()
        ..color = _gold.withValues(alpha: 0.55 * opacity)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7),
    );
    canvas.drawCircle(
      tip,
      4.5,
      Paint()..color = _brown.withValues(alpha: opacity),
    );
    canvas.drawCircle(
      tip,
      1.8,
      Paint()..color = _cream.withValues(alpha: opacity),
    );
  }

  @override
  bool shouldRepaint(_OrbitPainter old) =>
      old.turn != turn ||
      old.ripple != ripple ||
      old.opacity != opacity ||
      old.badgeRadius != badgeRadius;
}

/// A band of light that crosses the badge once.
class _SheenPainter extends CustomPainter {
  const _SheenPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0 || progress >= 1) return;
    final rect = Offset.zero & size;
    final x = -0.5 + 2 * progress;
    canvas.save();
    canvas.clipPath(Path()..addOval(rect));
    canvas.drawRect(
      rect,
      Paint()
        ..blendMode = BlendMode.plus
        ..shader = LinearGradient(
          begin: Alignment(x * 2 - 1.5, -1),
          end: Alignment(x * 2 - 0.9, 1),
          colors: const [
            Color(0x00FFFFFF),
            Color(0x66FFF3DC),
            Color(0x00FFFFFF),
          ],
        ).createShader(rect),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SheenPainter old) => old.progress != progress;
}

/// Small gold specks drifting slowly around the badge.
class _SparklePainter extends CustomPainter {
  const _SparklePainter({
    required this.centre,
    required this.radius,
    required this.turn,
    required this.opacity,
  });

  final Offset centre;
  final double radius;
  final double turn;
  final double opacity;

  static const _count = 12;

  @override
  void paint(Canvas canvas, Size size) {
    if (opacity <= 0) return;
    final paint = Paint();
    for (var i = 0; i < _count; i++) {
      final seed = i / _count;
      final wave = math.sin((turn + seed * 3) * 2 * math.pi);
      final angle = seed * 2 * math.pi + wave * 0.05;
      final reach =
          radius * (1.42 + 0.34 * ((i * 7) % _count) / _count) + wave * 5;
      final point = centre + Offset(math.cos(angle), math.sin(angle)) * reach;
      paint.color = (i.isEven ? _copper : _gold).withValues(
        alpha: opacity * (0.5 + 0.35 * wave),
      );
      canvas.drawCircle(point, i % 3 == 0 ? 2.6 : 1.7, paint);
    }
  }

  @override
  bool shouldRepaint(_SparklePainter old) =>
      old.turn != turn || old.opacity != opacity || old.centre != centre;
}
