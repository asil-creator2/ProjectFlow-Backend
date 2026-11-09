export async function requireAuth(request, response, next) {
  const authorization = request.get('authorization');
  const tokenMatch = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');

  if (!tokenMatch) {
    return response.status(401).json({ error: 'Authentication required' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    return response.status(503).json({ error: 'Authentication service unavailable' });
  }

  let authResponse;

  try {
    authResponse = await fetch(new URL('/auth/v1/user', `${supabaseUrl}/`), {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${tokenMatch[1]}`,
      },
    });
  } catch {
    return response.status(503).json({ error: 'Authentication service unavailable' });
  }

  if (authResponse.status === 401 || authResponse.status === 403) {
    return response.status(401).json({ error: 'Invalid or expired access token' });
  }

  if (!authResponse.ok) {
    return response.status(503).json({ error: 'Authentication service unavailable' });
  }

  let user;

  try {
    user = await authResponse.json();
  } catch {
    return response.status(503).json({ error: 'Authentication service unavailable' });
  }

  if (typeof user?.id !== 'string' || user.id.length === 0) {
    return response.status(503).json({ error: 'Authentication service unavailable' });
  }

  request.user = user;
  request.accessToken = tokenMatch[1];
  return next();
}