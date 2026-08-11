import * as React from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import {
  NavigationContainer,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Auto-push a self-referential native-stack screen to build a deep stack.
// Each push mounts a react-native-screens native Fragment (ScreenStackFragment
// with a nested childFragmentManager / ScreenFragment); they accumulate in the
// host Activity's saved state under
//   androidx.lifecycle.BundlableSavedStateRegistry.key -> android:support:fragments
// Watch the saved-state parcel grow: `adb logcat -s RNSRepro`
const TARGET_DEPTH = 100;
const AUTO_PUSH_MS = 80;

const Stack = createNativeStackNavigator();

function PushScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const depth: number =
    (route.params as { depth?: number } | undefined)?.depth ?? 0;

  React.useEffect(() => {
    if (depth < TARGET_DEPTH) {
      const id = setTimeout(
        () => navigation.push('Push', { depth: depth + 1 }),
        AUTO_PUSH_MS,
      );
      return () => clearTimeout(id);
    }
  }, [depth, navigation]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>
        Depth: {depth} / {TARGET_DEPTH}
      </Text>
      <Text style={styles.hint}>
        When auto-push stops: enable Developer Options → "Don't keep activities",
        then press Home to background the app.
        {'\n\n'}Watch the saved-state parcel + fragment payload:
        {'\n'}adb logcat -s RNSRepro
      </Text>
      <Button
        title="Push one more screen"
        onPress={() => navigation.push('Push', { depth: depth + 1 })}
      />
    </ScrollView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Push"
          component={PushScreen}
          initialParams={{ depth: 0 }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  hint: { fontSize: 13, color: '#555', lineHeight: 18 },
});
