import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { usePlayers } from '@/hooks/usePlayers';
import TurnstileWidget, { type TurnstileHandle } from '@/components/TurnstileWidget';
import { Spade, Lock, Mail, User, Loader2 } from 'lucide-react';

export default function Auth() {
  usePageTitle('Anmeldung');
  const navigate = useNavigate();
  const { data: players = [] } = usePlayers();

  // Shared password state
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  // Cloudflare Turnstile token for the /token (password login) GoTrue endpoint. Undefined until
  // the widget solves — and stays undefined forever when VITE_TURNSTILE_SITE_KEY is not set, in
  // which case this is a pure no-op (see TurnstileWidget.tsx and the PR body).
  const [loginCaptchaToken, setLoginCaptchaToken] = useState<string | null>(null);
  const loginTurnstileRef = useRef<TurnstileHandle>(null);

  // Signup state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPlayer, setSignupPlayer] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  // Same as above, for the /signup GoTrue endpoint.
  const [signupCaptchaToken, setSignupCaptchaToken] = useState<string | null>(null);
  const signupTurnstileRef = useRef<TurnstileHandle>(null);

  const handleSharedPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setPwError(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('verify-jass-password', {
        body: { password },
      });

      if (fnError || !data?.valid) {
        setPwError(true);
        setPassword('');
      } else {
        sessionStorage.setItem('jass-access', 'granted');
        navigate('/');
      }
    } catch {
      setPwError(true);
      setPassword('');
    } finally {
      setPwLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    // captchaToken is threaded through to GoTrue's /token endpoint. It is IGNORED by the server
    // until CAPTCHA is enabled in the project's Auth settings, so passing it (or not) is a no-op
    // today — which is what makes shipping this client change outage-safe on its own.
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
      options: loginCaptchaToken ? { captchaToken: loginCaptchaToken } : undefined,
    });

    // Turnstile tokens are single-use — get a fresh one for the next attempt regardless of outcome.
    loginTurnstileRef.current?.reset();

    if (error) {
      setLoginError('E-Mail oder Passwort falsch');
    } else {
      sessionStorage.setItem('jass-access', 'granted');
      navigate('/');
    }
    setLoginLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupLoading(true);
    setSignupError('');

    if (!signupPlayer) {
      setSignupError('Bitte wähle deinen Spieler');
      setSignupLoading(false);
      return;
    }

    // captchaToken is threaded through to GoTrue's /signup endpoint. Same no-op-until-server-enable
    // shape as handleLogin above.
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: signupCaptchaToken ? { captchaToken: signupCaptchaToken } : undefined,
    });

    // Turnstile tokens are single-use — get a fresh one for the next attempt regardless of outcome.
    signupTurnstileRef.current?.reset();

    if (authError) {
      setSignupError(authError.message);
      setSignupLoading(false);
      return;
    }

    // Link player to user
    if (authData.user) {
      const { error: linkError } = await supabase
        .from('players')
        .update({ user_id: authData.user.id })
        .eq('id', signupPlayer)
        .is('user_id', null);

      if (linkError) {
        setSignupError('Spieler konnte nicht verknüpft werden. Vielleicht schon vergeben?');
        setSignupLoading(false);
        return;
      }
    }

    setSignupSuccess(true);
    setSignupLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Spade className="h-8 w-8 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Beize Jass Tour</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="password">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="password" className="text-xs sm:text-sm">Passwort</TabsTrigger>
              <TabsTrigger value="login" className="text-xs sm:text-sm">Login</TabsTrigger>
              <TabsTrigger value="signup" className="text-xs sm:text-sm">Registrieren</TabsTrigger>
            </TabsList>

            {/* Shared Password Tab */}
            <TabsContent value="password">
              <form onSubmit={handleSharedPassword} className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground text-center">
                  Gib das gemeinsame Passwort ein
                </p>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="password"
                    placeholder="Passwort"
                    aria-label="Gemeinsames Passwort"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPwError(false); }}
                    className={`pl-10 ${pwError ? 'border-destructive' : ''}`}
                    autoFocus
                    disabled={pwLoading}
                  />
                </div>
                {pwError && (
                  <p className="text-sm text-destructive text-center" role="alert">Falsches Passwort</p>
                )}
                <Button type="submit" className="w-full" disabled={pwLoading}>
                  {pwLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                  Eintreten
                </Button>
              </form>
            </TabsContent>

            {/* Login Tab */}
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 mt-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="email"
                    placeholder="E-Mail"
                    aria-label="E-Mail-Adresse"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="pl-10"
                    disabled={loginLoading}
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="password"
                    placeholder="Passwort"
                    aria-label="Passwort"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10"
                    disabled={loginLoading}
                  />
                </div>
                {loginError && (
                  <p className="text-sm text-destructive text-center" role="alert">{loginError}</p>
                )}
                <TurnstileWidget ref={loginTurnstileRef} onToken={setLoginCaptchaToken} />
                <Button type="submit" className="w-full" disabled={loginLoading}>
                  {loginLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                  Anmelden
                </Button>
              </form>
            </TabsContent>

            {/* Signup Tab */}
            <TabsContent value="signup">
              {signupSuccess ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-lg font-semibold text-primary">Registrierung erfolgreich!</p>
                  <p className="text-sm text-muted-foreground">
                    Prüfe deine E-Mail für den Bestätigungslink.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="space-y-4 mt-4">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      type="email"
                      placeholder="E-Mail"
                      aria-label="E-Mail-Adresse"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      className="pl-10"
                      disabled={signupLoading}
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      type="password"
                      placeholder="Passwort (min. 6 Zeichen)"
                      aria-label="Passwort"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      className="pl-10"
                      minLength={6}
                      disabled={signupLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="signup-player" className="text-sm font-medium flex items-center gap-1.5">
                      <User className="h-4 w-4" aria-hidden="true" />
                      Ich bin...
                    </label>
                    <Select value={signupPlayer} onValueChange={setSignupPlayer}>
                      <SelectTrigger id="signup-player">
                        <SelectValue placeholder="Spieler wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {players.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {signupError && (
                    <p className="text-sm text-destructive text-center" role="alert">{signupError}</p>
                  )}
                  <TurnstileWidget ref={signupTurnstileRef} onToken={setSignupCaptchaToken} />
                  <Button type="submit" className="w-full" disabled={signupLoading}>
                    {signupLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                    Registrieren
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
