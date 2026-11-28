import crypto from 'node:crypto';

export const trackingToken = () => crypto.randomBytes(32).toString('hex');
export const trackingLink = (kind, token) => '/suivi#' + kind + '/' + token;
export const subscriptionPrices = {
  portfolio: { month: 500, year: 5000 },
  studio: { month: 1000, year: 12000 },
};

// The caller supplies the fixed SQL expression for the staff user ID.
export const subscriptionAllows = (staffId, studioOnly = false) => `EXISTS (
  SELECT 1 FROM users subscription_user WHERE subscription_user.id = ${staffId}
  AND (subscription_user.role = 'owner' OR (
    NOT subscription_user.subscription_suspended AND (
      subscription_user.subscription_exempt OR COALESCE((
        SELECT expires_at > CURRENT_TIMESTAMP ${studioOnly ? "AND plan = 'studio'" : ''}
        FROM photographer_subscriptions
        WHERE staff_id = subscription_user.id AND activated_at IS NOT NULL
        ORDER BY activated_at DESC, id DESC LIMIT 1
      ), FALSE)
    )
  ))
)`;
