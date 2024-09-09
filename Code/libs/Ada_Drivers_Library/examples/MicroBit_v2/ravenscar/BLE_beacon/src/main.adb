with MicroBit.DisplayRT; use MicroBit.DisplayRT;
with Beacon;
with Ada.Real_Time; use Ada.Real_Time;

procedure Main is
begin

   MicroBit.DisplayRT.Set_Animation_Step_Duration (80);

   Beacon.Initialize_Radio;

   loop

      if not MicroBit.DisplayRT.Animation_In_Progress then
         MicroBit.DisplayRT.Display_Async ("BLE beacon  ");
      end if;

      Beacon.Send_Beacon_Packet;

    delay until Clock + Milliseconds (500);

   end loop;
end Main;
