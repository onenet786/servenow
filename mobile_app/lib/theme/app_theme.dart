import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_text.dart';

/// The single ServeNow [ThemeData], shared by every role (customer, guest,
/// rider, store owner, admin).
class AppTheme {
  AppTheme._();

  static const ColorScheme colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.primary,
    onPrimary: Colors.white,
    primaryContainer: AppColors.tint100,
    onPrimaryContainer: AppColors.primaryDeep,
    primaryFixed: AppColors.tint100,
    primaryFixedDim: AppColors.tint200,
    onPrimaryFixed: AppColors.primaryDeep,
    onPrimaryFixedVariant: AppColors.primaryPressed,
    secondary: AppColors.primaryPressed,
    onSecondary: Colors.white,
    secondaryContainer: AppColors.tint50,
    onSecondaryContainer: AppColors.primaryDeep,
    tertiary: AppColors.info,
    onTertiary: Colors.white,
    tertiaryContainer: AppColors.infoBg,
    onTertiaryContainer: AppColors.info,
    error: AppColors.danger,
    onError: Colors.white,
    errorContainer: AppColors.dangerBg,
    onErrorContainer: AppColors.danger,
    surface: AppColors.surface,
    onSurface: AppColors.text,
    onSurfaceVariant: AppColors.text2,
    surfaceDim: AppColors.surface3,
    surfaceBright: AppColors.surface,
    surfaceContainerLowest: AppColors.surface,
    surfaceContainerLow: AppColors.surface2,
    surfaceContainer: AppColors.surface3,
    surfaceContainerHigh: AppColors.surface3,
    surfaceContainerHighest: AppColors.border,
    outline: AppColors.borderStrong,
    outlineVariant: AppColors.border,
    shadow: Color(0xFF111827),
    scrim: Color(0xFF111827),
    inverseSurface: AppColors.text,
    onInverseSurface: Colors.white,
    inversePrimary: AppColors.tint200,
    surfaceTint: Colors.transparent,
  );

  static TextTheme _textTheme({double? height}) {
    TextStyle s(double size, FontWeight weight, Color color, {double ls = 0}) {
      return TextStyle(
        fontFamily: AppText.latinFamily,
        fontFamilyFallback: AppText.fallback,
        fontSize: size,
        fontWeight: weight,
        color: color,
        letterSpacing: ls,
        height: height,
      );
    }

    return TextTheme(
      displayLarge: s(40, FontWeight.w800, AppColors.text, ls: -0.8),
      displayMedium: s(32, FontWeight.w800, AppColors.text, ls: -0.6),
      displaySmall: s(26, FontWeight.w800, AppColors.text, ls: -0.4),
      headlineLarge: s(26, FontWeight.w800, AppColors.text, ls: -0.4),
      headlineMedium: s(24, FontWeight.w800, AppColors.text, ls: -0.3),
      headlineSmall: s(22, FontWeight.w800, AppColors.text, ls: -0.2),
      titleLarge: s(18, FontWeight.w700, AppColors.text),
      titleMedium: s(16, FontWeight.w700, AppColors.text),
      titleSmall: s(14, FontWeight.w700, AppColors.text),
      bodyLarge: s(16, FontWeight.w400, AppColors.text),
      bodyMedium: s(14, FontWeight.w400, AppColors.text),
      bodySmall: s(12.5, FontWeight.w500, AppColors.text2),
      labelLarge: s(14, FontWeight.w700, AppColors.text),
      labelMedium: s(12, FontWeight.w600, AppColors.text2),
      labelSmall: s(11, FontWeight.w600, AppColors.text2),
    );
  }

  static ThemeData light() => _build(urdu: false);

  /// Same theme with tall line heights for Nastaliq. Applied by
  /// `LanguageScope` around customer screens when Urdu is selected.
  static ThemeData urdu() => _build(urdu: true);

  static ThemeData _build({required bool urdu}) {
    final textTheme = _textTheme(height: urdu ? AppText.urduLineHeight : null);
    const controlShape = RoundedRectangleBorder(
      borderRadius: AppRadius.controlAll,
    );
    // Nastaliq lines are tall: give the text the vertical room instead.
    final buttonPadding = EdgeInsets.symmetric(
      horizontal: 20,
      vertical: urdu ? 4 : 14,
    );
    final buttonText = textTheme.labelLarge!.copyWith(
      fontSize: 15,
      fontWeight: FontWeight.w700,
      color: null,
    );

    OutlineInputBorder inputBorder(Color color, [double width = 1]) {
      return OutlineInputBorder(
        borderRadius: AppRadius.controlAll,
        borderSide: BorderSide(color: color, width: width),
      );
    }

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      fontFamily: AppText.latinFamily,
      fontFamilyFallback: AppText.fallback,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      scaffoldBackgroundColor: AppColors.background,
      canvasColor: AppColors.surface,
      dividerColor: AppColors.border,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      dividerTheme: const DividerThemeData(
        color: AppColors.border,
        thickness: 1,
        space: 1,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.text,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        shadowColor: AppColors.border,
        centerTitle: false,
        titleSpacing: 4,
        systemOverlayStyle: SystemUiOverlayStyle.dark.copyWith(
          statusBarColor: Colors.transparent,
        ),
        // No title/icon styles here: the M3 defaults (titleLarge, icons)
        // follow foregroundColor, so AppBars that set their own colours
        // (e.g. the green store-owner bar with white text) keep them.
        shape: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      cardTheme: const CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: AppColors.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.surface3,
          disabledForegroundColor: AppColors.muted,
          elevation: 0,
          minimumSize: const Size(64, AppSpace.tapTarget),
          padding: buttonPadding,
          textStyle: buttonText,
          shape: controlShape,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.surface3,
          disabledForegroundColor: AppColors.muted,
          minimumSize: const Size(64, AppSpace.tapTarget),
          padding: buttonPadding,
          textStyle: buttonText,
          shape: controlShape,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryPressed,
          side: const BorderSide(color: AppColors.borderStrong),
          minimumSize: const Size(64, AppSpace.tapTarget),
          padding: buttonPadding,
          textStyle: buttonText,
          shape: controlShape,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primary,
          minimumSize: const Size(48, 44),
          textStyle: buttonText.copyWith(fontSize: 14),
          shape: controlShape,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: AppColors.text,
          minimumSize: const Size(AppSpace.tapTarget, AppSpace.tapTarget),
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.cardAll),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        isDense: false,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
        hintStyle: textTheme.bodyMedium!.copyWith(color: AppColors.muted),
        labelStyle: textTheme.bodyMedium!.copyWith(color: AppColors.text2),
        floatingLabelStyle: textTheme.bodyMedium!.copyWith(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
        ),
        prefixIconColor: AppColors.muted,
        suffixIconColor: AppColors.muted,
        errorStyle: textTheme.bodySmall!.copyWith(color: AppColors.danger),
        border: inputBorder(AppColors.borderStrong),
        enabledBorder: inputBorder(AppColors.borderStrong),
        disabledBorder: inputBorder(AppColors.border),
        focusedBorder: inputBorder(AppColors.primary, 1.6),
        errorBorder: inputBorder(AppColors.danger),
        focusedErrorBorder: inputBorder(AppColors.danger, 1.6),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.surface,
        selectedColor: AppColors.tint100,
        secondarySelectedColor: AppColors.tint100,
        disabledColor: AppColors.surface3,
        checkmarkColor: AppColors.primaryPressed,
        side: const BorderSide(color: AppColors.border),
        labelStyle: textTheme.labelLarge!.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
        ),
        secondaryLabelStyle: textTheme.labelLarge!.copyWith(
          fontSize: 13,
          color: AppColors.primaryDeep,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        shape: const StadiumBorder(),
        showCheckmark: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.tint100,
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.primaryPressed : AppColors.muted,
            size: 24,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return textTheme.labelMedium!.copyWith(
            color: selected ? AppColors.primaryDeep : AppColors.text2,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
          );
        }),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: AppColors.surface,
        selectedItemColor: AppColors.primaryPressed,
        unselectedItemColor: AppColors.muted,
        selectedLabelStyle: textTheme.labelMedium!.copyWith(
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelStyle: textTheme.labelMedium,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.tint100,
        selectedIconTheme: IconThemeData(color: AppColors.primaryPressed),
        unselectedIconTheme: IconThemeData(color: AppColors.muted),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.primaryPressed,
        unselectedLabelColor: AppColors.text2,
        indicatorColor: AppColors.primary,
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: AppColors.border,
        labelStyle: textTheme.labelLarge,
        unselectedLabelStyle: textTheme.labelLarge!.copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: AppColors.text2,
        textColor: AppColors.text,
        titleTextStyle: textTheme.bodyLarge!.copyWith(
          fontWeight: FontWeight.w600,
        ),
        subtitleTextStyle: textTheme.bodySmall,
        minVerticalPadding: 10,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        titleTextStyle: textTheme.titleLarge,
        contentTextStyle: textTheme.bodyMedium!.copyWith(
          color: AppColors.text2,
        ),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.cardAll),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: AppColors.surface,
        elevation: 8,
        showDragHandle: true,
        dragHandleColor: AppColors.borderStrong,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        textStyle: textTheme.bodyMedium,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        elevation: 2,
        showCloseIcon: true,
        backgroundColor: AppColors.text,
        closeIconColor: Colors.white70,
        actionTextColor: AppColors.tint200,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
        contentTextStyle: textTheme.bodyMedium!.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w600,
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.primary,
        linearTrackColor: AppColors.tint100,
        circularTrackColor: Colors.transparent,
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? AppColors.primary : null,
        ),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.smallAll),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? AppColors.primary
              : AppColors.borderStrong,
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Colors.white : null,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? AppColors.primary : null,
        ),
      ),
      datePickerTheme: const DatePickerThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        headerBackgroundColor: AppColors.primary,
        headerForegroundColor: Colors.white,
      ),
      badgeTheme: const BadgeThemeData(
        backgroundColor: AppColors.danger,
        textColor: Colors.white,
      ),
      tooltipTheme: const TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.text,
          borderRadius: AppRadius.smallAll,
        ),
      ),
    );
  }
}
