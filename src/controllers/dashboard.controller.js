import dashboardService from '../services/dashboard.service.js';

/**
 * Dashboard Controller - read-only statistics for the admin/staff home dashboard.
 */
class DashboardController {
  /**
   * GET /dashboard/overview - Aggregated stats (cards, charts, recent activity)
   */
  async getOverview(req, res, next) {
    try {
      const data = await dashboardService.getOverview();
      res.json({ data });
    } catch (error) {
      next(error);
    }
  }
}

export default new DashboardController();
