export {}

declare global {
  interface Window {
    circleAPI: {
      requestMediaAccess(): Promise<{ camera: boolean; microphone: boolean }>
      getCallToken(code: string, identity: string, name: string): Promise<{ url: string; token: string; room: string }>
      setCallMode(on: boolean): Promise<void>
    }
  }
}
