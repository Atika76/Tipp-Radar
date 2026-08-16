const { json, apiConfigured, supabaseConfigured } = require('./_shared');
exports.handler = async () => json(200, {
  ok:true,
  apiConfigured:apiConfigured(),
  supabaseConfigured:supabaseConfigured(),
  mode:apiConfigured() ? (supabaseConfigured() ? 'live+persistence' : 'live') : 'demo'
});
