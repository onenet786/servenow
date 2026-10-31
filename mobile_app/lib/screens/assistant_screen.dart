import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/ui/ui.dart';

/// The ServeNow chat assistant (AIAgent): text, voice messages and Live voice calls.
///
/// Asks the server for the signed-in person's chat identity, then opens `assistant.html` with it in
/// the URL fragment, so the assistant can answer about their own orders, wallet or deliveries.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key});

  static void open(BuildContext context) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AssistantScreen()));
  }

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  /// The <title> of assistant.html.
  static const _pageTitle = 'ServeNow help';

  WebViewController? _controller;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    final token = context.read<AuthProvider>().token;
    try {
      final session = await ApiService.getAssistantSession(token);
      if (session['enabled'] != true) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = "Chat isn't available right now. Please try again later.";
        });
        return;
      }
      final fragment = Uri(
        queryParameters: {
          if (session['identity'] is String)
            'identity': session['identity'] as String,
          if (session['scope'] is String) 'scope': session['scope'] as String,
        },
      ).query;
      final page = Uri.parse(
        '${ApiService.baseUrl}/assistant.html',
      ).replace(fragment: fragment);
      final controller = _buildController();
      await controller.loadRequest(page);
      if (!mounted) return;
      setState(() => _controller = controller);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiServiceException
            ? e.message
            : "Couldn't open the chat. Check your internet connection.";
      });
    }
  }

  WebViewController _buildController() {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      // iOS: play the assistant's voice replies inline and without an extra tap.
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    final controller =
        WebViewController.fromPlatformCreationParams(
            params,
            onPermissionRequest: _onPermissionRequest,
          )
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(AppColors.background)
          ..setNavigationDelegate(
            NavigationDelegate(
              onPageFinished: (_) => _checkPage(),
              onNavigationRequest: (request) {
                final uri = Uri.tryParse(request.url);
                final own = Uri.parse(ApiService.baseUrl);
                if (uri == null ||
                    uri.host == own.host ||
                    request.url.startsWith('about:')) {
                  return NavigationDecision.navigate;
                }
                // Links in answers (a store's map, a review page) open outside the app.
                launchUrl(uri, mode: LaunchMode.externalApplication);
                return NavigationDecision.prevent;
              },
            ),
          );
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    return controller;
  }

  /// A server without assistant.html answers with its home page (the login screen). Show a message
  /// instead of that page.
  Future<void> _checkPage() async {
    final title = await _controller?.getTitle();
    if (!mounted) return;
    if (title != null && title != _pageTitle) {
      setState(() {
        _controller = null;
        _loading = false;
        _error = "Chat isn't set up on the server yet. Please try again later.";
      });
      return;
    }
    setState(() => _loading = false);
  }

  /// The chat asks for the microphone for voice messages and Live calls. The phone asks the person
  /// first; the page only gets the microphone when they allow it.
  Future<void> _onPermissionRequest(WebViewPermissionRequest request) async {
    final wantsAudio = request.types.contains(
      WebViewPermissionResourceType.microphone,
    );
    final onlyAudio = request.types.every(
      (t) => t == WebViewPermissionResourceType.microphone,
    );
    if (!wantsAudio || !onlyAudio) {
      await request.deny();
      return;
    }
    final status = await Permission.microphone.request();
    if (status.isGranted) {
      await request.grant();
      return;
    }
    await request.deny();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text(
          'Allow the microphone for ServeNow to send voice messages or talk live.',
        ),
        action: status.isPermanentlyDenied
            ? SnackBarAction(label: 'Settings', onPressed: openAppSettings)
            : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('ServeNow help')),
      body: Stack(
        children: [
          if (controller != null) WebViewWidget(controller: controller),
          if (_error != null)
            EmptyState(
              icon: Icons.chat_bubble_outline,
              title: 'Chat unavailable',
              message: _error,
              isError: true,
              actionLabel: 'Try again',
              onAction: _start,
            )
          else if (_loading)
            const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}

/// App-bar button that opens the chat assistant (rider, store owner and admin screens).
class AssistantButton extends StatelessWidget {
  const AssistantButton({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.support_agent),
      tooltip: 'Chat with ServeNow help',
      onPressed: () => AssistantScreen.open(context),
    );
  }
}
