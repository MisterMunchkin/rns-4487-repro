import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
  useRoute,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// ============================================================================
// react-native-screens #4487 repro — set MODE below, then background the app.
//
// Measured on Android 16, RNS 4.18.0, RN 0.81.5, New Architecture (Fabric) ON.
// Observe the saved-state parcel on background:  adb logcat -s RNSRepro
// (enable Developer Options -> "Don't keep activities", then press Home)
//
//   'opaque'            Plain push stack. For an opaque top screen RNS sets
//                       visibleBottom == null and transaction.remove()s every
//                       fragment except the top (ScreenStack.kt), so a removed
//                       fragment is NOT serialised -> the parcel is FLAT with
//                       depth:  3952 B at depth 3 AND at depth 100.
//                       (This is the case a plain push stack hits — it does not
//                       leak. Original #4487 repro used this by mistake.)
//
//   'transparentModal' Opaque root + a stack of `transparentModal` screens.
//                       Those are TRANSLUCENT (Screen.isTranslucent() is true for
//                       TRANSPARENT_MODAL / FORM_SHEET), so RNS keeps them all
//                       add()-ed and the parcel scales LINEARLY:
//                         depth 3 -> 8152, 20 -> 31952, 40 -> 59952
//                         (= 3952 + 1400 * depth,  R^2 = 1)
//
//   'nested'           Root Stack -> Bottom-Tabs -> per-tab Stacks (one double-
//                       nested) + a `formSheet` on top. Mirrors a real nested
//                       react-navigation app. Retained by BREADTH (mounted nav
//                       nodes x nesting), amplified by the translucent sheet:
//                         opaque baseline 3952 ; nested 7176 ; nested + sheet 8576
//                       Scale the tree / use real screens to reach the Binder
//                       (~1 MB) limit -> TransactionTooLargeException.
// ============================================================================
const MODE: 'opaque' | 'transparentModal' | 'nested' = 'transparentModal';

const TARGET_DEPTH = 40; // opaque / transparentModal: auto-push depth
const TAB_DEPTH = 6; //    nested: screens auto-pushed inside each tab's stack
const USE_SHEET = true; //  nested: present the translucent formSheet on top
const AUTO_PUSH_MS = 80;

// ---------------------------------------------------------------------------
// 'opaque' / 'transparentModal' — a self-referential push stack over an opaque
// root. The root MUST stay opaque so that, in transparentModal mode,
// `visibleBottom` resolves to it and RNS retains the translucent run above it.
// ---------------------------------------------------------------------------
const PushStack = createNativeStackNavigator();

function RootScreen() {
  const navigation = useNavigation<any>();
  React.useEffect(() => {
    const id = setTimeout(() => navigation.push('Modal', { depth: 1 }), AUTO_PUSH_MS);
    return () => clearTimeout(id);
  }, [navigation]);
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Root (opaque base)</Text>
    </View>
  );
}

function ModalScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const depth: number = (route.params as { depth?: number } | undefined)?.depth ?? 1;
  React.useEffect(() => {
    if (depth < TARGET_DEPTH) {
      const id = setTimeout(() => navigation.push('Modal', { depth: depth + 1 }), AUTO_PUSH_MS);
      return () => clearTimeout(id);
    }
    console.log('RNSReproSettled mode=' + MODE + ' depth=' + depth);
  }, [depth, navigation]);

  // In transparentModal mode, cascade each layer (modulo, to stay on-screen) so
  // the retained stack is VISIBLE — every card you see is a fragment still add()-ed.
  const step = depth % 12;
  const cascade = MODE === 'transparentModal';
  return (
    <View style={styles.pushFill}>
      <View style={[styles.card, cascade && { transform: [{ translateX: step * 22 }, { translateY: step * 52 }] }]}>
        <Text style={styles.cardText}>
          Depth {depth} / {TARGET_DEPTH}
        </Text>
      </View>
    </View>
  );
}

function PushApp() {
  const translucent = MODE === 'transparentModal';
  return (
    <NavigationContainer>
      <PushStack.Navigator screenOptions={{ headerShown: false }}>
        <PushStack.Screen name="Root" component={RootScreen} initialParams={{ depth: 0 }} />
        <PushStack.Screen
          name="Modal"
          component={ModalScreen}
          options={translucent ? { presentation: 'transparentModal' } : undefined}
        />
      </PushStack.Navigator>
    </NavigationContainer>
  );
}

// ---------------------------------------------------------------------------
// 'nested' — Root Stack -> Bottom-Tabs -> per-tab native Stacks (one double-
// nested) + a translucent formSheet on top. Faithful to a real nested app.
// ---------------------------------------------------------------------------
function makeAutoPushScreen(routeName: string) {
  return function AutoPushScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const depth: number = (route.params as { depth?: number } | undefined)?.depth ?? 0;
    React.useEffect(() => {
      if (depth < TAB_DEPTH) {
        const id = setTimeout(() => navigation.push(routeName, { depth: depth + 1 }), AUTO_PUSH_MS);
        return () => clearTimeout(id);
      }
    }, [depth, navigation]);
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          {routeName} — depth {depth}/{TAB_DEPTH}
        </Text>
      </View>
    );
  };
}

function makeTabStack(tag: string) {
  const S = createNativeStackNavigator();
  const Screen = makeAutoPushScreen(tag);
  return function TabStack() {
    return (
      <S.Navigator screenOptions={{ headerShown: false }}>
        <S.Screen name={tag} component={Screen} initialParams={{ depth: 0 }} />
      </S.Navigator>
    );
  };
}

function makeNestedTabStack(tag: string) {
  const Outer = createNativeStackNavigator();
  const Inner = createNativeStackNavigator();
  const InnerScreen = makeAutoPushScreen(tag + 'Inner');
  function InnerStack() {
    return (
      <Inner.Navigator screenOptions={{ headerShown: false }}>
        <Inner.Screen name={tag + 'Inner'} component={InnerScreen} initialParams={{ depth: 0 }} />
      </Inner.Navigator>
    );
  }
  return function NestedTabStack() {
    return (
      <Outer.Navigator screenOptions={{ headerShown: false }}>
        <Outer.Screen name={tag + 'Outer'} component={InnerStack} />
      </Outer.Navigator>
    );
  };
}

const Tab = createBottomTabNavigator();
function TabsScreen() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="TabA" component={makeTabStack('A')} />
      <Tab.Screen name="TabB" component={makeTabStack('B')} />
      <Tab.Screen name="TabC" component={makeNestedTabStack('C')} />
    </Tab.Navigator>
  );
}

function SheetScreen() {
  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetText}>formSheet on top (translucent) — retains the tree below</Text>
    </View>
  );
}

const Root = createNativeStackNavigator();
function NestedApp() {
  const navRef = useNavigationContainerRef();
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (!ready) return;
    // Driver: visit every tab (mount its nested stack), then present the sheet.
    const t: ReturnType<typeof setTimeout>[] = [];
    t.push(setTimeout(() => navRef.navigate('Main' as never, { screen: 'TabB' } as never), 3000));
    t.push(setTimeout(() => navRef.navigate('Main' as never, { screen: 'TabC' } as never), 6000));
    t.push(setTimeout(() => navRef.navigate('Main' as never, { screen: 'TabA' } as never), 9000));
    if (USE_SHEET) t.push(setTimeout(() => navRef.navigate('Sheet' as never), 11000));
    t.push(setTimeout(() => console.log('RNSReproSettled mode=nested sheet=' + USE_SHEET), 13000));
    return () => t.forEach(clearTimeout);
  }, [ready, navRef]);
  return (
    <NavigationContainer ref={navRef} onReady={() => setReady(true)}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Main" component={TabsScreen} />
        <Root.Screen name="Sheet" component={SheetScreen} options={{ presentation: 'formSheet' }} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return MODE === 'nested' ? <NestedApp /> : <PushApp />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  pushFill: { flex: 1, alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 40, paddingLeft: 24 },
  card: { backgroundColor: '#1f6feb', padding: 12, borderRadius: 10 },
  cardText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  text: { fontSize: 16, fontWeight: '600', color: '#111' },
  sheet: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f6feb' },
  sheetText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
