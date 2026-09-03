import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

import { supportsNativeLiquidGlass } from "../lib/native-glass-capability";

// Native Liquid Glass detection now rides on expo-glass-effect (the same API
// GlassSurface uses) after the fork dropped @callstack/liquid-glass.
export const NATIVE_LIQUID_GLASS_SUPPORTED = supportsNativeLiquidGlass(
  Platform.OS,
  isGlassEffectAPIAvailable(),
);
