import { FontAwesome, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy'; // 또는 'expo-file-system' (버전에 맞게 사용)
import { useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// --- [유틸리티] 지연 함수 ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  type?: 'simple' | 'confirm';
  actionCommand?: string;
  isAnswered?: boolean;
}

// --- 로봇 얼굴 컴포넌트 ---
const RobotFace = ({ emotion, isSpeaking }: { emotion: string; isSpeaking: boolean }) => {
  const eyeColor = emotion === 'error' ? '#ff4d4d' : '#333';
  return (
    <View style={styles.robotFaceContainer}>
      <View style={[styles.robotHead, isSpeaking && styles.robotSpeaking]}>
        <View style={styles.eyesContainer}>
          <View style={[styles.eye, { backgroundColor: eyeColor }, emotion === 'listening' && styles.eyeBlinking]} />
          <View style={[styles.eye, { backgroundColor: eyeColor }, emotion === 'listening' && styles.eyeBlinking]} />
        </View>
        <View style={[styles.mouth, emotion === 'happy' && styles.mouthHappy]} />
      </View>
    </View>
  );
};

export default function CommandScreen() {
  const { userId, userName } = useLocalSearchParams<{ userId: string, userName: string }>();
  const user = { id: userId || 'guest', name: userName || '사용자' };
  const socket = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [robotStatus, setRobotStatus] = useState('대기 중');
  const [robotEmotion, setRobotEmotion] = useState<'happy' | 'listening' | 'thinking' | 'error'>('happy');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const [recording, setRecording] = useState<Audio.Recording | undefined>(undefined);
  const [isRecording, setIsRecording] = useState(false);
  const [sosModalVisible, setSosModalVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // --- 1. 듣기(TTS) 모드 설정: 스피커 강제 및 DuckOthers 사용 ---
  const setModePlayback = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false, // 스피커 강제
        interruptionModeIOS: InterruptionModeIOS.DuckOthers, // [변경] DoNotMix -> DuckOthers
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });
    } catch (e) {
      console.log('Playback Mode Error:', e);
    }
  };

  // --- 2. 녹음(Record) 모드 설정 ---
  const setModeRecord = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });
    } catch (e) {
      console.log('Record Mode Error:', e);
    }
  };

  useEffect(() => {
    setModePlayback();
  }, []);

  // --- TTS 함수 (핵심 수정: 지연 및 모드 확실화) ---
  const speak = async (text: string) => {
    Speech.stop(); // 기존 음성 중단
    
    // 모드 재설정
    await setModePlayback();
    
    // OS 오디오 라우팅 변경 대기 (소리가 작다면 이 값을 300~500으로 늘려보세요)
    await delay(300); 

    setIsSpeaking(true);
    Speech.speak(text, {
      language: 'ko-KR',
      rate: 0.9,
      pitch: 1.0,
      onDone: () => {
        setIsSpeaking(false);
        setRobotEmotion('happy');
      },
      onError: () => setIsSpeaking(false),
    });
  };

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), ...msg },
    ]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // --- 소켓 및 초기 인사 ---
  useEffect(() => {
    setTimeout(() => {
        addMessage({ sender: 'bot', text: `${user.name}님, 무엇을 도와드릴까요?`, type: 'simple' });
        speak(`${user.name}님, 무엇을 도와드릴까요?`);
    }, 800); // 초기 진입 시 안정화 시간 확보

    if (!socket) return;

    const handleUserSpeech = (data: { text: string }) => {
      console.log("🎤 내 말 인식됨:", data.text);
      addMessage({ sender: 'user', text: data.text, type: 'simple' });
      setRobotStatus('생각 중...');
      setRobotEmotion('thinking');
    };

    const handleCommandResponse = async (response: any) => {
      console.log("📥 서버 응답:", response);
      setRobotStatus('대기 중');
      setRobotEmotion('happy');

      if (response.recognized_text) {
        addMessage({ sender: 'user', text: response.recognized_text, type: 'simple' });
      } else if (response.meta && response.meta.recognized_text) {
         addMessage({ sender: 'user', text: response.meta.recognized_text, type: 'simple' });
      }

      addMessage({
        sender: 'bot',
        text: response.text,
        type: response.type,
        actionCommand: response.meta, 
        isAnswered: false,
      });

      await speak(response.text);
    };

    socket.on('user-speech', handleUserSpeech);
    socket.on('command-response', handleCommandResponse);

    return () => {
      socket.off('user-speech', handleUserSpeech);
      socket.off('command-response', handleCommandResponse);
      Speech.stop();
    };
  }, [socket, user.name, addMessage]);

  const sendMessage = () => {
    if (inputText.trim().length === 0) return;
    addMessage({ sender: 'user', text: inputText, type: 'simple' });
    setRobotStatus('처리 중...');
    setRobotEmotion('thinking');
    
    if (socket) {
      socket.emit('command', { userId: user.id, text: inputText });
    } else {
      setTimeout(() => {
        addMessage({ sender: 'bot', text: '서버 연결 안 됨', type: 'simple' });
      }, 500);
    }
    setInputText('');
  };

  // --- 🎤 녹음 시작 ---
  const startRecording = async () => {
    try {
      Speech.stop();
      setIsSpeaking(false);

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert("권한 거부", "마이크 권한이 필요합니다.");
        return;
      }

      await delay(100);
      await setModeRecord();
      await delay(100);

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
      setRobotStatus('듣고 있어요...');
      setRobotEmotion('listening');
    } catch (err) {
      console.error("녹음 시작 실패", err);
      setRobotStatus('오류 발생');
      setRobotEmotion('error');
    }
  };

  // --- 🎤 녹음 종료 및 전송 (가장 중요한 해결 부분) ---
  const stopRecordingAndSend = async () => {
    setIsRecording(false);
    setRobotStatus('처리 중...');
    setRobotEmotion('thinking');
    setRecording(undefined);

    if (!recording) return;

    try {
      // 1. 녹음 중단 및 메모리 해제
      await recording.stopAndUnloadAsync();
      
      // 2. 하드웨어 점유 해제 대기
      await delay(200);

      // [핵심 해결책] 3. 오디오 엔진을 리셋하여 수화부(통화모드)에서 스피커(미디어모드)로 강제 전환 유도
      await Audio.setIsEnabledAsync(false);
      await delay(50);
      await Audio.setIsEnabledAsync(true);

      // 4. 미디어 모드로 확실히 설정
      await setModePlayback();
      
      // 5. 모드가 적용될 시간을 줌
      await delay(300);

      const uri = recording.getURI();

      if (uri && socket) {
        const base64String = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });
        socket.emit('audio-upload', {
          audioData: base64String,
          format: 'm4a',
          userId: user.id
        });
      }
    } catch (error) {
      console.error("전송 실패:", error);
      setRobotStatus("전송 실패");
      setRobotEmotion('error');
    }
  };

  const handleMicPress = () => {
    if (isRecording) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  };

  const handleConfirmAction = (messageId: string, action: string, isYes: boolean) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, isAnswered: true } : msg
    ));

    if (isYes) {
      addMessage({ sender: 'user', text: '네, 해주세요.', type: 'simple' });
      setRobotStatus('실행 중...');
      socket?.emit('action-confirm', { userId: user.id, command: action });
    } else {
      addMessage({ sender: 'user', text: '아니요.', type: 'simple' });
      speak("취소했습니다.");
    }
  };

  const handleSOSRequest = () => {
    setSosModalVisible(true);
    speak("긴급 호출을 하시겠습니까?");
  };

  const confirmSOS = () => {
    setSosModalVisible(false);
    addMessage({ sender: 'system', text: '🚨 긴급 호출이 발송되었습니다.', type: 'simple' });
    setRobotStatus('긴급 상황');
    setRobotEmotion('error');
    speak("긴급 호출이 발송되었습니다.");
    socket?.emit('command', { userId: user.id, text: 'SOS 긴급 호출' });
  };

  const cancelSOS = () => {
    setSosModalVisible(false);
    speak("취소되었습니다.");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <RobotFace emotion={robotEmotion} isSpeaking={isSpeaking} />
            <View style={styles.statusContainer}>
              <Text style={styles.headerTitle}>로봇 도우미</Text>
              <Text style={[styles.headerStatus, robotStatus === '긴급 상황' && styles.statusEmergency]}>
                {robotStatus}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.sosButton} onPress={handleSOSRequest} activeOpacity={0.7}>
            <MaterialIcons name="phone-in-talk" size={32} color="white" />
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatContent}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 16 }}>
              <View style={[
                styles.messageBubble,
                item.sender === 'user' ? styles.userBubble : 
                item.sender === 'system' ? styles.systemBubble : styles.botBubble,
              ]}>
                <Text style={[
                  styles.messageText,
                  item.sender === 'user' ? styles.userText : 
                  item.sender === 'system' ? styles.systemText : styles.botText,
                ]}>
                  {item.text}
                </Text>
              </View>
              {item.sender === 'bot' && item.type === 'confirm' && !item.isAnswered && (
                <View style={styles.buttonGroup}>
                  <TouchableOpacity style={[styles.actionBtn, styles.yesBtn]} onPress={() => handleConfirmAction(item.id, item.actionCommand || '', true)}>
                    <Text style={styles.actionBtnText}>네</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.noBtn]} onPress={() => handleConfirmAction(item.id, item.actionCommand || '', false)}>
                    <Text style={[styles.actionBtnText, { color: '#333' }]}>아니오</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          style={styles.chatArea}
        />

        <View style={styles.inputContainer}>
          <TouchableOpacity style={[styles.micButton, isRecording && styles.micButtonRecording]} onPress={handleMicPress}>
            <FontAwesome name={isRecording ? "stop" : "microphone"} size={24} color="white" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRecording ? "듣고 있어요..." : "메시지 입력..."}
            placeholderTextColor="#999"
            onSubmitEditing={sendMessage}
            editable={!isRecording}
          />
          <TouchableOpacity style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!inputText.trim()}>
            <Ionicons name="send" size={24} color="white" />
          </TouchableOpacity>
        </View>

        <Modal animationType="fade" transparent={true} visible={sosModalVisible} onRequestClose={cancelSOS}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <MaterialIcons name="campaign" size={60} color="#dc2626" />
              <Text style={styles.modalTitle}>긴급 호출</Text>
              <Text style={styles.modalDesc}>보호자에게 긴급 메시지를{"\n"}보내시겠습니까?</Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnYes]} onPress={confirmSOS}>
                  <Text style={styles.modalBtnText}>예 (호출)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnNo]} onPress={cancelSOS}>
                  <Text style={[styles.modalBtnText, {color:'#333'}]}>아니요</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15, backgroundColor: 'white', 
    borderBottomWidth: 2, borderColor: '#e5e7eb', marginTop: Platform.OS === 'android' ? 30 : 0,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  statusContainer: { justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  headerStatus: { fontSize: 16, color: '#0ea5e9', fontWeight: '600' },
  statusEmergency: { color: '#dc2626', fontWeight: 'bold' },
  robotFaceContainer: { marginRight: 15 },
  robotHead: {
    width: 60, height: 60, backgroundColor: '#e0f2fe', borderRadius: 30,
    borderWidth: 2, borderColor: '#0ea5e9', justifyContent: 'center', alignItems: 'center',
  },
  robotSpeaking: { borderColor: '#22c55e', borderWidth: 3 },
  eyesContainer: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  eye: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#333' },
  eyeBlinking: { opacity: 0.5 },
  mouth: { width: 20, height: 4, borderRadius: 2, backgroundColor: '#333' },
  mouthHappy: { height: 8, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: 'transparent', borderWidth: 2, borderTopWidth: 0, borderColor: '#333' },
  sosButton: {
    backgroundColor: '#dc2626', width: 70, height: 70, borderRadius: 35,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: "#dc2626", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  sosText: { color: 'white', fontWeight: 'bold', marginTop: 2, fontSize: 12 },
  chatArea: { flex: 1, backgroundColor: '#f0f2f5' },
  chatContent: { padding: 15, paddingBottom: 20 },
  messageBubble: {
    padding: 16, borderRadius: 20, maxWidth: '85%',
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, elevation: 1,
  },
  userBubble: { backgroundColor: '#3b82f6', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: 'white', alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  systemBubble: { backgroundColor: '#fef2f2', alignSelf: 'center', borderColor: '#fca5a5', borderWidth: 2, alignItems: 'center' },
  messageText: { fontSize: 18, lineHeight: 26 },
  userText: { color: 'white' },
  botText: { color: '#1f2937' },
  systemText: { color: '#991b1b', fontWeight: 'bold', textAlign: 'center' },
  buttonGroup: { flexDirection: 'row', marginTop: 8, marginLeft: 4, gap: 10, justifyContent: 'flex-start' },
  actionBtn: {
    paddingVertical: 12, paddingHorizontal: 25, borderRadius: 15, elevation: 3, minWidth: 80, alignItems: 'center',
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1,
  },
  yesBtn: { backgroundColor: '#3b82f6' },
  noBtn: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  actionBtnText: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', padding: 15,
    backgroundColor: 'white', borderTopWidth: 1, borderColor: '#e5e7eb',
  },
  micButton: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#9ca3af', justifyContent: 'center', alignItems: 'center', marginRight: 10, elevation: 2,
  },
  micButtonRecording: {
    backgroundColor: '#ef4444', borderWidth: 3, borderColor: '#fecaca',
  },
  input: {
    flex: 1, height: 56, borderColor: '#d1d5db', borderWidth: 2, borderRadius: 28,
    paddingHorizontal: 20, fontSize: 18, backgroundColor: '#f9fafb', marginRight: 10, color: '#111',
  },
  sendButton: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#3b82f6',
    justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  sendButtonDisabled: { backgroundColor: '#9ca3af' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: 'white', borderRadius: 24, padding: 30, alignItems: 'center', elevation: 10 },
  modalTitle: { fontSize: 28, fontWeight: 'bold', color: '#dc2626', marginVertical: 10 },
  modalDesc: { fontSize: 18, color: '#4b5563', textAlign: 'center', marginBottom: 30, lineHeight: 26 },
  modalButtons: { flexDirection: 'row', width: '100%', gap: 15 },
  modalBtn: { flex: 1, paddingVertical: 18, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  modalBtnYes: { backgroundColor: '#dc2626' },
  modalBtnNo: { backgroundColor: '#e5e7eb', borderWidth: 1, borderColor: '#d1d5db' },
  modalBtnText: { fontSize: 20, fontWeight: 'bold', color: 'white' },
});