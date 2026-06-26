import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

const PALETTE = [
  '#1B2A6B', '#C9952A', '#27AE60', '#2980B9',
  '#8E44AD', '#D35400', '#16A085', '#C0392B',
];

function letterColor(name) {
  return PALETTE[(name ?? ' ').toUpperCase().charCodeAt(0) % PALETTE.length];
}

export default function ProductAvatar({ imageUrl, name = '?', size = 42, borderRadius = 10 }) {
  const [imgError, setImgError] = useState(false);

  if (imageUrl && !imgError) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius }}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <View style={[
      styles.avatar,
      { width: size, height: size, borderRadius, backgroundColor: letterColor(name) },
    ]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>
        {name[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar:  { alignItems: 'center', justifyContent: 'center' },
  letter:  { fontWeight: '800', color: '#fff' },
});
