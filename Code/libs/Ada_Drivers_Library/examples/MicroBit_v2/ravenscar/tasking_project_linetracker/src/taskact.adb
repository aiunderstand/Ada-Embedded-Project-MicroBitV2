package body TaskAct is

   task body act is
      myClock  : Time;
      Decision : Directions := Forward;
   begin

      --For example set the PWM period, as you only need to do this once
      Set_Analog_Period_Us(20_000); --20 ms = 50 Hz, typical for many actuators. You can change this, check the motor behavior with an oscilloscope.

      loop
         myClock := Clock;

         --retrieve decision
         Decision := MotorDriver.GetDirection;

         --execute decision
         Drive (Decision);

         delay until myClock + Milliseconds(50);  
         --random period, but faster than 20 ms is no use because Set_Analog_Period_Us(20000) !
         --faster is better but note the weakest link: if decisions in the thinking task come at 100ms and acting come at 20ms
         --then no change is set in the acting task for at least 5x (and is wasting power to wake up and execute task!)
      end loop;
   end act;

   procedure Drive (Direction : Directions) is
   begin
      case Direction is
         when Forward =>
            DriveWheel(w => (11,12,0, True, False, 512)); --LF
            DriveWheel(w => (13,14,1, True, False, 512)); --LB
            DriveWheel(w => (15,16,2, True, False, 512)); --RF
            DriveWheel(w => (19,20,3, True, False, 512)); --RB
         when Left =>
            DriveWheel(w => (11,12,0, False, True, 512));
            DriveWheel(w => (13,14,1, True, False, 512));
            DriveWheel(w => (15,16,2, True, False, 512));
            DriveWheel(w => (19,20,3, False, True, 512));
         when Right =>
            DriveWheel(w => (11,12,0, True, False, 512));
            DriveWheel(w => (13,14,1, False, True, 512));
            DriveWheel(w => (15,16,2, False, True, 512));
            DriveWheel(w => (19,20,3, True, False, 512));
         when Stop =>
            DriveWheel(w => (11,12,0, False, False, 0));
            DriveWheel(w => (13,14,1, False, False, 0));
            DriveWheel(w => (15,16,2, False, False, 0));
            DriveWheel(w => (19,20,3, False, False, 0));
      end case;
   end Drive;
   
   procedure DriveWheel(w : Wheel) is
     begin
          Set (w.PinForward, w.PinForwardValue);
          Set (w.PinBackward, w.PinBackwardValue);
          Write (w.PinSpeed, w.PinSpeedValue);   
      end DriveWheel;

end TaskAct;
