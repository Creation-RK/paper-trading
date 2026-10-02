import { useEffect } from 'react';
import { IconCandles, IconTrophy, IconUsers } from './components/Icons';
import { ToastHost } from './components/ui';
import { navigate, useRoute } from './router';
import { Home } from './screens/Home';
import { Profiles } from './screens/Profiles';
import { Scorecard } from './screens/Scorecard';
import { Session } from './screens/Session';
import { SystemEditor } from './screens/SystemEditor';
import { useGame } from './store/game';

/** Apply the in-app theme choice; "Match device" leaves the root untouched so the host or OS decides. */
function useThemePreference() {
  const theme = useGame((s) => s.settings.theme ?? 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      if (root.dataset.appTheme) {
        delete root.dataset.theme;
        delete root.dataset.appTheme;
      }
      return;
    }
    root.dataset.theme = theme;
    root.dataset.appTheme = '1';
  }, [theme]);
}

export function App() {
  const route = useRoute();
  useThemePreference();

  if (route.name === 'play') {
    return (
      <>
        <Session date={route.date} symbol={route.symbol} />
        <ToastHost />
      </>
    );
  }

  const tab = route.name === 'profiles' || route.name === 'system' ? 'profiles' : route.name === 'scorecard' ? 'scorecard' : 'home';
  return (
    <div className="app">
      {route.name === 'home' && <Home />}
      {route.name === 'profiles' && <Profiles />}
      {route.name === 'system' && <SystemEditor key={route.profileId} profileId={route.profileId} />}
      {route.name === 'scorecard' && <Scorecard />}
      <nav className="tabbar" aria-label="Main">
        <button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => navigate('/')}>
          <IconCandles />
          Play
        </button>
        <button aria-current={tab === 'profiles' ? 'page' : undefined} onClick={() => navigate('/profiles')}>
          <IconUsers />
          Profiles
        </button>
        <button aria-current={tab === 'scorecard' ? 'page' : undefined} onClick={() => navigate('/scorecard')}>
          <IconTrophy />
          Scorecard
        </button>
      </nav>
      <ToastHost />
    </div>
  );
}
