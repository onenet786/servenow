import 'package:flutter/material.dart';

class AutoRechargeSettings extends StatefulWidget {
  final bool isEnabled;
  final double? rechargeAmount;
  final double? thresholdAmount;
  final bool isLoading;
  final String? error;
  final Function(bool, double, double) onSave;

  const AutoRechargeSettings({
    super.key,
    this.isEnabled = false,
    this.rechargeAmount,
    this.thresholdAmount,
    this.isLoading = false,
    this.error,
    required this.onSave,
  });

  @override
  State<AutoRechargeSettings> createState() => _AutoRechargeSettingsState();
}

class _AutoRechargeSettingsState extends State<AutoRechargeSettings> {
  late bool _isEnabled;
  late TextEditingController _rechargeController;
  late TextEditingController _thresholdController;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    _isEnabled = widget.isEnabled;
    _rechargeController = TextEditingController(
      text: widget.rechargeAmount?.toStringAsFixed(2) ?? '',
    );
    _thresholdController = TextEditingController(
      text: widget.thresholdAmount?.toStringAsFixed(2) ?? '',
    );
  }

  @override
  void dispose() {
    _rechargeController.dispose();
    _thresholdController.dispose();
    super.dispose();
  }

  bool _validateInputs() {
    setState(() {
      _validationError = null;
    });

    if (!_isEnabled) {
      return true;
    }

    final rechargeText = _rechargeController.text.trim();
    final thresholdText = _thresholdController.text.trim();

    if (rechargeText.isEmpty) {
      setState(() {
        _validationError = 'Recharge amount is required';
      });
      return false;
    }

    if (thresholdText.isEmpty) {
      setState(() {
        _validationError = 'Threshold amount is required';
      });
      return false;
    }

    final rechargeAmount = double.tryParse(rechargeText);
    final thresholdAmount = double.tryParse(thresholdText);

    if (rechargeAmount == null || rechargeAmount <= 0) {
      setState(() {
        _validationError = 'Recharge amount must be greater than 0';
      });
      return false;
    }

    if (thresholdAmount == null || thresholdAmount <= 0) {
      setState(() {
        _validationError = 'Threshold amount must be greater than 0';
      });
      return false;
    }

    if (thresholdAmount >= rechargeAmount) {
      setState(() {
        _validationError = 'Threshold must be less than recharge amount';
      });
      return false;
    }

    return true;
  }

  void _handleSave() {
    if (!_validateInputs()) {
      return;
    }

    if (!_isEnabled) {
      widget.onSave(false, 0, 0);
      return;
    }

    final rechargeAmount = double.parse(_rechargeController.text.trim());
    final thresholdAmount = double.parse(_thresholdController.text.trim());

    widget.onSave(_isEnabled, rechargeAmount, thresholdAmount);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF667eea).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: const Color(0xFF667eea).withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.info_outline,
                  color: Color(0xFF667eea),
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Auto-recharge will automatically add funds to your wallet when balance drops below the threshold',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey.shade700,
                      height: 1.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Auto-Recharge',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Colors.black87,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _isEnabled ? 'Enabled' : 'Disabled',
                    style: TextStyle(
                      fontSize: 13,
                      color: _isEnabled ? Colors.green : Colors.grey.shade600,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              Switch(
                value: _isEnabled,
                onChanged: (value) {
                  setState(() {
                    _isEnabled = value;
                    _validationError = null;
                  });
                },
                activeThumbColor: const Color(0xFF667eea),
              ),
            ],
          ),
          const SizedBox(height: 20),
          if (_isEnabled) ...[
            const Text(
              'Recharge Amount (PKR)',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.black87,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _rechargeController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              enabled: !widget.isLoading,
              decoration: InputDecoration(
                hintText: 'e.g., 5000',
                hintStyle: TextStyle(color: Colors.grey.shade400),
                prefixText: 'PKR ',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(
                    color: Color(0xFF667eea),
                    width: 2,
                  ),
                ),
                filled: true,
                fillColor: Colors.grey.shade50,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Threshold Amount (PKR)',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.black87,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _thresholdController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              enabled: !widget.isLoading,
              decoration: InputDecoration(
                hintText: 'e.g., 1000',
                hintStyle: TextStyle(color: Colors.grey.shade400),
                prefixText: 'PKR ',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(
                    color: Color(0xFF667eea),
                    width: 2,
                  ),
                ),
                filled: true,
                fillColor: Colors.grey.shade50,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'When balance falls below this amount, we\'ll automatically add the recharge amount',
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey.shade600,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
          if (_validationError != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.red.shade200),
              ),
              child: Row(
                children: [
                  Icon(Icons.error_outline, color: Colors.red.shade700),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _validationError!,
                      style: TextStyle(
                        color: Colors.red.shade700,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (widget.error != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.red.shade200),
              ),
              child: Row(
                children: [
                  Icon(Icons.error_outline, color: Colors.red.shade700),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      widget.error!,
                      style: TextStyle(
                        color: Colors.red.shade700,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: widget.isLoading ? null : _handleSave,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF667eea),
                disabledBackgroundColor: Colors.grey.shade300,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: widget.isLoading
                  ? SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          Colors.white.withValues(alpha: 0.8),
                        ),
                      ),
                    )
                  : Text(
                      _isEnabled ? 'Save Settings' : 'Disable Auto-Recharge',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
