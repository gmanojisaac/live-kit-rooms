import CreateRoomForm from '@/components/rooms/CreateRoomForm';
import LiveMeetHeader from '@/components/media/LiveMeetHeader';

export const metadata = {
  title: 'Create Meeting — Live Meet',
};

export default function CreateRoomPage() {
  return (
    <div className="gm-home-container">
      <LiveMeetHeader />
      <main className="gm-create-container">
        <div className="gm-create-card">
          <h1>Create Room</h1>
          <p>
            Start a private video meeting with screen sharing and real-time prompt review.
          </p>
          <CreateRoomForm />
        </div>
      </main>
    </div>
  );
}
