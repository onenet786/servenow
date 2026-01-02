# Flutter/Android Proguard rules
# Keep Flutter classes
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.embedding.** { *; }

# Keep Provider/JSON models if using reflection (adjust if needed)
-keep class com.google.gson.** { *; }
-keepattributes Signature
-keepattributes *Annotation*

# Stripe and Google Play services (if used)
-keep class com.stripe.** { *; }
-dontwarn com.stripe.**
-dontwarn com.google.android.gms.**

# okhttp/okio if used via http clients
-dontwarn okhttp3.**
-dontwarn okio.**

# Retrofit/Gson adapters (if used)
-dontwarn retrofit2.**

# Keep model classes in your app package (adjust package name)
-keep class com.example.servenow.** { *; }

# Prevent R8 from stripping Google Play Core and Flutter deferred components
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
-keep class com.google.android.play.core.splitcompat.SplitCompatApplication { *; }
-keep class com.google.android.play.core.splitinstall.** { *; }
-dontwarn com.google.android.play.core.splitinstall.**
-keep class com.google.android.play.core.tasks.** { *; }
-dontwarn com.google.android.play.core.tasks.**

# Keep Flutter's Play Store split classes
-keep class io.flutter.embedding.engine.deferredcomponents.** { *; }
-keep class io.flutter.embedding.android.FlutterPlayStoreSplitApplication { *; }
