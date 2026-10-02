import CreateRoomForm from '@/components/rooms/CreateRoomForm';
import LiveMeetHeader from '@/components/media/LiveMeetHeader';
import { getRoomPolicy } from '@/lib/rooms/policy.js';

// Read TEAM_MEMBERS at request time, not at build time.
export const dynamic = 'force-dynamic';

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
          <CreateRoomForm teamMembers={[...getRoomPolicy().teamMembers]} />
        </div>
      </main>
    </div>
  );
}
