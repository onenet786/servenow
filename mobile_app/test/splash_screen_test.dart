import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servenow/screens/splash_screen.dart';

void main() {
  testWidgets('tells the app once the intro has played, once only', (
    tester,
  ) async {
    var done = 0;
    await tester.pumpWidget(
      MaterialApp(home: SplashScreen(onIntroDone: () => done++)),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pump();
    expect(done, 0);
    await tester.pump(const Duration(milliseconds: 1800));
    await tester.pump(const Duration(milliseconds: 100));
    expect(done, 1);
    await tester.pump(const Duration(seconds: 5));
    expect(done, 1);
  });

  testWidgets('with animations off it is ready at once and nothing runs', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(360, 800));
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);

    var done = 0;
    await tester.pumpWidget(
      MaterialApp(home: SplashScreen(onIntroDone: () => done++)),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pump();
    expect(done, 1);
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('fits a small phone without overflowing', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 568));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(const MaterialApp(home: SplashScreen()));
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
  });
}
