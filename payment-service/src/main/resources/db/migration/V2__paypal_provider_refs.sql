-- V2: provider references for real payment providers (PayPal).
-- provider_order_id: the buyer-approved PayPal order supplied when the trip is requested.
-- provider_reference: the PayPal authorization id, needed later to capture or void.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_order_id varchar(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_reference varchar(255);
