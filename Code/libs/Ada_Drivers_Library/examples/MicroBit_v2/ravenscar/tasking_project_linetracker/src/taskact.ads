with MyMotorDriver; use MyMotorDriver;

with Ada.Real_Time;          use Ada.Real_Time;
with MicroBit.IOsForTasking; use MicroBit.IOsForTasking;

package TaskAct is

   task Act with Priority=> 2;

   type Wheel is record
      PinForward : Pin_Id;
      PinBackward : Pin_Id;
      PinSpeed : Pin_Id;  
      PinForwardValue: Boolean;
      PinBackwardValue: Boolean;
      PinSpeedValue: Analog_Value;
   end record;
   
   procedure Drive (direction : Directions);
   
   procedure DriveWheel(w : Wheel);
   
end TaskAct;
