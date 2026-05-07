import verificationService from '../services/verification.service.js';

/**
 * Verification Controller - Handles public PDF verification endpoint.
 */
class VerificationController {
  /**
   * Build an absolute public URL from the current request.
   * @param {object} req - Express request
   * @param {string} publicPath - Public path beginning with /
   * @returns {string} Absolute URL
   */
  buildPublicUrl(req, publicPath) {
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${req.get('host')}${publicPath}`;
  }

  /**
   * Add browser-displayable PDF URL to a verification result.
   * @param {object} req - Express request
   * @param {object} result - Verification result
   * @returns {object} Verification result with PDF URL
   */
  withPdfUrl(req, result) {
    if (!result.pdf?.path) {
      return result;
    }

    return {
      ...result,
      pdf: {
        ...result.pdf,
        url: this.buildPublicUrl(req, result.pdf.path),
      },
    };
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

  /**
   * POST /verify/code - Verify a stored PDF by verificationCode
   * GET /verify/code/:verificationCode - Verify a stored PDF by verificationCode
   */
  async verifyByCode(req, res, next) {
    try {
      const verificationCode = req.body?.verificationCode || req.body?.verification_code || req.params?.verificationCode || req.query?.verificationCode || req.query?.verification_code;

      if (!verificationCode) {
        return res.status(400).json({
          success: false,
          message: 'verificationCode is required',
        });
      }

      const result = await verificationService.verifyLetterByCode(verificationCode);

      return res.status(200).json({
        success: true,
        data: this.withPdfUrl(req, result),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      next(error);
    }
  }
}

export default new VerificationController();
