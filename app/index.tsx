import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// TTS 및 오디오 제어를 위한 라이브러리
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';

// --- [유틸리티] 지연 함수 ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// [상수] 무음 오디오 파일
const SILENT_AUDIO_URI = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82xZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA';

// [상수] 다국어 텍스트 정의
const TRANSLATIONS = {
  ko: {
    title: '블라썸',
    subtitle: '로봇 도우미',
    loginBtn: '로그인',
    loginBtnScanning: '인식 중...',
    statusIdle: '로그인 버튼을 눌러주세요',
    statusScanning: '사용자를 확인하고 있습니다...',
    otherMethod: '다른 방법으로 로그인',
    welcomeMsg: (name: string) => `${name}님, 환영합니다.`,
    ttsLocale: 'ko-KR',
  },
  en: {
    title: 'VLAssom',
    subtitle: 'Robot Assistant',
    loginBtn: 'Login',
    loginBtnScanning: 'Scanning...',
    statusIdle: 'Please press the login button',
    statusScanning: 'Verifying user...',
    otherMethod: 'Login with other methods',
    welcomeMsg: (name: string) => `Welcome, ${name}.`,
    ttsLocale: 'en-US',
  }
};

type LanguageType = 'ko' | 'en';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  // [로그] 컴포넌트 렌더링 확인
  console.log('[AuthScreen] Rendering...');

  const [permission, requestPermission] = useCameraPermissions();
  
  // [상태] 언어 설정 ('ko' | 'en')
  const [language, setLanguage] = useState<LanguageType>('ko');
  
  // 현재 언어 팩 가져오기
  const t = TRANSLATIONS[language];

  const [customStatusMessage, setCustomStatusMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const socket = useSocket();
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<any>(null);
  const isFocused = useIsFocused();
  
  const silentSoundRef = useRef<Audio.Sound | null>(null);

  // 1. 오디오 모드 설정
  const setAudioToSpeaker = async () => {
    console.log('[Audio] Setting audio mode to speaker...');
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
      console.log('[Audio] Audio mode set successfully.');
    } catch (error) {
      console.error('[Audio] 오디오 모드 설정 실패:', error);
    }
  };

  // 2. 초기화
  useEffect(() => {
    console.log('[AuthScreen] Mounted via useEffect.');

    const initAudio = async () => {
      await setAudioToSpeaker();
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: SILENT_AUDIO_URI },
          { shouldPlay: false, volume: 0 }
        );
        silentSoundRef.current = sound;
        console.log('[Audio] Silent sound loaded.');
      } catch (error) {
        console.error('[Audio] 무음 파일 로드 실패', error);
      }
    };

    initAudio();

    return () => {
      console.log('[AuthScreen] Unmounting... Cleanup triggered.');
      if (silentSoundRef.current) {
        silentSoundRef.current.unloadAsync();
      }
      Speech.stop();
    };
  }, []);

  // 3. 카메라 권한 체크
  useEffect(() => {
    console.log(`[Camera] Permission Status: ${permission?.status}, Granted: ${permission?.granted}`);
    if (!permission?.granted) {
      console.log('[Camera] Requesting permission...');
      requestPermission();
    }
  }, [permission, requestPermission]);

  // 4. 소켓 이벤트 및 인증 성공 로직
  useEffect(() => {
    if (!socket) {
      console.warn('[Socket] Socket instance is null.');
      return;
    }

    console.log(`[Socket] Listener Setup (Lang: ${language})`);

    const handleAuthSuccess = async (user: User) => {
      console.log('✅ [Socket] Auth Success Received:', user);
      
      setIsScanning(false);
      stopStreaming();
      
      const welcomeText = TRANSLATIONS[language].welcomeMsg(user.name);
      console.log(`[Auth] Welcome message generated: "${welcomeText}"`);
      setCustomStatusMessage(welcomeText);

      await setAudioToSpeaker();

      try {
        if (silentSoundRef.current) {
          console.log('[Audio] Replaying silent sound (Speaker Kick)...');
          await silentSoundRef.current.replayAsync();
        }
        await delay(800); 
      } catch (e) {
        console.error('[Audio] Audio Kick Failed', e);
      }

      const speechText = `, , ${welcomeText}`;
      console.log(`[TTS] Speaking: "${speechText}" (Locale: ${TRANSLATIONS[language].ttsLocale})`);
      
      Speech.speak(speechText, {
        language: TRANSLATIONS[language].ttsLocale,
        pitch: 1.0,
        rate: 1.0,
        onStart: () => console.log('[TTS] Started speaking.'),
        onDone: () => {
           console.log('[TTS] Finished speaking. Navigating to /command...');
           router.replace({
            pathname: '/command',
            params: { userId: user.id, userName: user.name, lang: language },
          });
        },
        onError: (e) => console.error('[TTS] Error:', e)
      });
    };

    const handleAuthFail = () => {
      console.log('❌ [Socket] Auth Fail Received. Retrying...');
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    return () => {
      console.log('[Socket] Cleaning up listeners.');
      stopStreaming();
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
      Speech.stop();
    };
  }, [socket, isFocused, language]);

  // 5. 카메라 스트리밍 제어
  const stopStreaming = () => {
    console.log('[Stream] Stopping streaming...');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsScanning(false);
    setCustomStatusMessage(null);
  };

  const startStreaming = () => {
    if (intervalRef.current) {
      console.log('[Stream] Already streaming. Ignoring request.');
      return;
    }
    
    console.log('[Stream] Starting streaming...');
    setIsScanning(true);
    setCustomStatusMessage(null);

    const captureAndSend = async () => {
  if (cameraRef.current) {
    try {
      // 1. 일단 사진을 찍습니다 (base64는 여기서 받지 않음 -> 메모리 절약)
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5, // 여기서 quality는 크게 의미 없음, 리사이징때 조절
        skipProcessing: true,
        shutterSound: false,
      });

      if (photo?.uri) {
        // 2. 이미지 리사이징 및 압축 (가로 500px로 줄임)
        // 얼굴 인식용으로는 500px도 충분히 고화질입니다.
        const manipulated = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 500 } }], // 가로 500px로 리사이징 (세로는 비율 유지)
          { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true } // 압축률 0.5 & Base64 변환
        );

        if (manipulated.base64) {
          // 로그로 줄어든 용량 확인 (아마 50kb ~ 100kb 수준으로 줄어들 것임)
          console.log(`[Socket] Emitting 'identify-face' (Original: ~5MB -> Resized: ${manipulated.base64.length}, Lang: ${language})`);
          
          socket?.emit('identify-face', {
            image: manipulated.base64,
            lang: language
          });
        }
      }
    } catch (error) {
      console.log('--- 스냅샷/리사이징 오류 ---', error);
    }
  }
};
    
    captureAndSend();
    intervalRef.current = setInterval(captureAndSend, 1500);
  };

  const handleLoginPress = () => {
    console.log('[UI] Login Button Pressed');
    if (!permission?.granted) {
      console.log('[UI] Permission not granted, requesting...');
      requestPermission();
      return;
    }
    if (isScanning) {
        console.log('[UI] Already scanning. Ignoring press.');
        return;
    }
    
    if (silentSoundRef.current) {
        silentSoundRef.current.replayAsync().catch((e) => console.log('[Audio] Replay ignore:', e));
    }

    startStreaming();
  };

  const handleLanguageChange = (lang: LanguageType) => {
    console.log(`[UI] Language changed to: ${lang}`);
    setLanguage(lang);
  };

  // 현재 상태에 따른 메시지 결정 함수
  const getDisplayStatusMessage = () => {
    if (customStatusMessage) return customStatusMessage;
    if (isScanning) return t.statusScanning;
    return t.statusIdle;
  };

  if (!permission) {
    console.log('[Render] Waiting for permission status...');
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {permission.granted && (
        <CameraView
          ref={cameraRef}
          style={styles.hiddenCamera}
          facing="front"
          autofocus="off"
        />
      )}

      {/* 언어 선택 버튼 영역 */}
      <View style={styles.langSwitchContainer}>
        <TouchableOpacity 
          onPress={() => handleLanguageChange('ko')}
          style={[styles.langButton, language === 'ko' && styles.langButtonActive]}
        >
          <Text style={[styles.langText, language === 'ko' && styles.langTextActive]}>KOR</Text>
        </TouchableOpacity>
        <View style={styles.langDivider} />
        <TouchableOpacity 
          onPress={() => handleLanguageChange('en')}
          style={[styles.langButton, language === 'en' && styles.langButtonActive]}
        >
          <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>ENG</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contentContainer}>
        
        {/* 로고 영역 */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoIconContainer}>
            <MaterialCommunityIcons name="robot" size={60} color="white" />
          </View>
          <Text style={styles.logoTitle}>{t.title}</Text>
          <Text style={styles.logoSubtitle}>{t.subtitle}</Text>
        </View>

        {/* 버튼 영역 */}
        <View style={styles.buttonWrapper}>
          <TouchableOpacity 
            style={[styles.loginButton, isScanning && styles.loginButtonActive]} 
            onPress={handleLoginPress}
            activeOpacity={0.8}
            disabled={isScanning}
          >
            {isScanning ? (
               <MaterialCommunityIcons name="face-recognition" size={24} color="rgba(255,255,255,0.7)" style={styles.btnIcon} />
            ) : (
               <MaterialCommunityIcons name="face-recognition" size={24} color="white" style={styles.btnIcon} />
            )}
            <Text style={styles.loginButtonText}>
              {isScanning ? t.loginBtnScanning : t.loginBtn}
            </Text>
          </TouchableOpacity>

          <Text style={styles.statusText}>{getDisplayStatusMessage()}</Text>

          <TouchableOpacity style={styles.subButton}>
            <Text style={styles.subButtonText}>{t.otherMethod}</Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  langSwitchContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    padding: 4,
    zIndex: 10,
    alignItems: 'center',
  },
  langButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  langButtonActive: {
    backgroundColor: '#0056b3',
  },
  langDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#ccc',
    marginHorizontal: 2,
  },
  langText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
  },
  langTextActive: {
    color: '#fff',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: -1,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  logoWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoIconContainer: {
    width: 120,
    height: 120,
    backgroundColor: '#0056b3',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  logoTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: '#000',
    marginBottom: 5,
  },
  logoSubtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#555',
  },
  buttonWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  loginButton: {
    backgroundColor: '#0056b3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 60,
    borderRadius: 15,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loginButtonActive: {
    backgroundColor: '#004494',
  },
  btnIcon: {
    marginRight: 10,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusText: {
    color: '#666',
    marginBottom: 20,
    fontSize: 18,
    textAlign: 'center',
  },
  subButton: {
    padding: 10,
  },
  subButtonText: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});