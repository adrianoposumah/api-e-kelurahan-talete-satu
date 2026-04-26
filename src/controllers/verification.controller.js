import verificationService from '../services/verification.service.js';

/**
 * Verification Controller - Handles public PDF verification endpoint.
 */
class VerificationController {
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
