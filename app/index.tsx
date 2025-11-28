import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// TTS 및 오디오 제어를 위한 라이브러리
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [statusMessage, setStatusMessage] = useState('로그인 버튼을 눌러주세요'); // 초기 메시지 변경
  const [isScanning, setIsScanning] = useState(false);

  const socket = useSocket();
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<number | null>(null);
  const isFocused = useIsFocused();

  // 스피커 모드 강제 설정 함수
  const setAudioToSpeaker = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
    } catch (error) {
      console.log('오디오 모드 설정 실패:', error);
    }
  };

  useEffect(() => {
    setAudioToSpeaker();
  }, []);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!socket) return;

    const handleAuthSuccess = async (user: User) => {
      console.log('인증 성공:', user.name);
      const successText = `${user.name}님, 환영합니다.`;
      
      setStatusMessage(successText);
      setIsScanning(false);
      stopStreaming();

      await setAudioToSpeaker();

      Speech.speak(successText, {
        language: 'ko-KR',
        pitch: 1.0,
        rate: 1.0,
      });

      setTimeout(() => {
        router.replace({
          pathname: '/command',
          params: { userId: user.id, userName: user.name },
        });
      }, 3000);
    };

    const handleAuthFail = () => {
      console.log('인증 실패 - 다시 시도 중...');
      // 실패해도 계속 스캔하거나, 메시지만 업데이트 할 수 있습니다.
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    // [변경됨] 화면 진입 시 자동 시작 로직(startStreaming) 제거됨

    return () => {
      stopStreaming();
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
      Speech.stop();
    };
  }, [socket, isFocused]); // permission 의존성 제거 (버튼 클릭 시 체크하므로)

  const stopStreaming = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsScanning(false);
  };

  const startStreaming = () => {
    if (intervalRef.current) return;
    
    setIsScanning(true);
    setStatusMessage('사용자를 확인하고 있습니다...');

    // 즉시 한 번 실행 후 인터벌 시작 (반응 속도 향상)
    const captureAndSend = async () => {
      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.2,
            base64: true,
            skipProcessing: true,
            shutterSound: false,
          });

          if (photo && photo.base64) {
            socket?.emit('identify-face', photo.base64);
          } 
        } catch (error) {
          console.log('--- 스냅샷 오류 ---', error);
        }
      }
    };

    captureAndSend(); // 첫 클릭 즉시 실행
    intervalRef.current = window.setInterval(captureAndSend, 3000);
  };

  const handleLoginPress = () => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    // 이미 스캔 중이면 중단할지, 아니면 무시할지 결정 (여기선 재시작 방지)
    if (isScanning) return;
    
    startStreaming();
  };

  if (!permission) {
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

      <View style={styles.contentContainer}>
        
        {/* 로고 영역: flex: 1을 주어 중앙을 차지하게 함 */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoIconContainer}>
            <MaterialCommunityIcons name="robot" size={60} color="white" />
          </View>
          <Text style={styles.logoTitle}>블라썸</Text>
          <Text style={styles.logoSubtitle}>로봇 도우미</Text>
        </View>

        {/* 버튼 영역: 하단에 고정 */}
        <View style={styles.buttonWrapper}>
          <TouchableOpacity 
            style={[styles.loginButton, isScanning && styles.loginButtonActive]} 
            onPress={handleLoginPress}
            activeOpacity={0.8}
            disabled={isScanning} // 스캔 중 중복 클릭 방지
          >
            {isScanning ? (
               <MaterialCommunityIcons name="face-recognition" size={24} color="rgba(255,255,255,0.7)" style={styles.btnIcon} />
            ) : (
               <MaterialCommunityIcons name="face-recognition" size={24} color="white" style={styles.btnIcon} />
            )}
            <Text style={styles.loginButtonText}>
              {isScanning ? '인식 중...' : '로그인'}
            </Text>
          </TouchableOpacity>

          {/* 상태 메시지를 버튼 아래에 표시하거나 버튼 텍스트로 사용 */}
          <Text style={styles.statusText}>{statusMessage}</Text>

          <TouchableOpacity style={styles.subButton}>
            <Text style={styles.subButtonText}>다른 방법으로 로그인</Text>
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
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: -1,
  },
  contentContainer: {
    flex: 1,
    // justifyContent: 'space-between' 제거 -> Flex 비율로 제어
    paddingHorizontal: 30,
    paddingBottom: 50, // 하단 여백
  },
  logoWrapper: {
    flex: 1, // 화면의 남은 공간을 모두 차지하여 수직 중앙 정렬 효과
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0, // 기존 margin 제거
  },
  logoIconContainer: {
    width: 120, // 크기 살짝 키움
    height: 120,
    backgroundColor: '#0056b3',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
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
    justifyContent: 'flex-end', // 하단 정렬
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
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loginButtonActive: {
    backgroundColor: '#004494', // 눌렸을 때 색상 약간 변경
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