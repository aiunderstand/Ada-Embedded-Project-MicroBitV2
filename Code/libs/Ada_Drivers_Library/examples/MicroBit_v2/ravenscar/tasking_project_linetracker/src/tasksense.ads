with MyMotorDriver; use MyMotorDriver; --protected object to communicate with TaskAct

with Ada.Real_Time; use Ada.Real_Time;
with MicroBit.IOsForTasking; use MicroBit.IOsForTasking;

package TaskSense is

   task LineReading with Priority=> 1;
   
   function LineTrackerRead(pin : Pin_Id) return Boolean;
   
end TaskSense;
