with MicroBit.IOsForTasking;  use MicroBit.IOsForTasking;
with MicroBit;
with MicroBit.MotorDriver; use MicroBit.MotorDriver; --using the procedures defined here
with DFR0548;  -- using the types defined here
with MicroBit.Console; use MicroBit.Console; -- for serial port communication
use MicroBit; --for pin names

procedure Main is

begin
   MotorDriver.Servo(1,90);
   delay 1.0; -- equivalent of Time.Sleep(1000) = 1 second

   loop
      --   DEMONSTRATION ROUTINE 4 MOTORS (useful for checking your wiring)
      --  MotorDriver.Drive(Forward,(4095,0,0,0)); --right front wheel to M4
      --  delay 1.0;
      --  MotorDriver.Drive(Forward,(0,4095,0,0)); --right back wheel to M3
      --  delay 1.0;
      --  MotorDriver.Drive(Forward,(0,0,4095,0)); --left front wheel to M2
      --  delay 1.0;
      --  MotorDriver.Drive(Forward,(0,0,0,4095)); --left back wheel to M1
      --  delay 1.0;
      --  MotorDriver.Drive(Stop);


      MotorDriver.Drive(Forward);
      delay 1.0;
      MotorDriver.Drive(stop);

      delay 3.0;


   end loop;
end Main;
