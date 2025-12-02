import { Stack } from 'expo-router';
import React from 'react';

export default function UserLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // we’ll make our own header/back button
        presentation: 'card',
        contentStyle: { backgroundColor: '#05010B' }, // match app bg
      }}
    />
  );
}