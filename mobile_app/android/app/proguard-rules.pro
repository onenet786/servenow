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
