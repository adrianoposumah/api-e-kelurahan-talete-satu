import verificationService from '../services/verification.service.js';

/**
 * Verification Controller - Handles public PDF verification endpoint.
 */
class VerificationController {
  /**
   * GET /verify/:verificationCode
   */
  async verifyByCode(req, res, next) {
    try {
      const verificationCode = req.params?.verificationCode || req.query?.verificationCode || req.query?.verification_code;

      if (!verificationCode) {
        return res.status(400).json({ success: false, message: 'verificationCode is required' });
      }

      const { serverCheck, signatureCheck, ...result } = await verificationService.verifyLetterByCode(verificationCode);

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          serverCheck: { pass: serverCheck.pass, status: serverCheck.status, reason: serverCheck.reason },
          signatureCheck: { pass: signatureCheck.pass, status: signatureCheck.status, reason: signatureCheck.reason, signerCommonName: signatureCheck.signerCommonName, keyStatus: signatureCheck.keyStatus },
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: error.message });
      if (error.code === 'BAD_REQUEST') return res.status(400).json({ success: false, message: error.message });
      next(error);
    }
  }

  /**
   * POST /verify - Verify uploaded PDF letter
   */
  async verify(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided',
        });
      }

      const result = await verificationService.verifyLetter(req.file.buffer);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }


}

export default new VerificationController();
