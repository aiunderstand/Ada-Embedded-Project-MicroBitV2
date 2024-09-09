package body TaskSense is

   task body LineReading is
      MyClock          : Time;
      LineTrackerLeft  : Boolean    := False;
      LineTrackerRight : Boolean    := False;
      Decision         : Directions := Forward;
   begin
      loop
         MyClock := Clock;

         --read sensor values
         LineTrackerLeft  := LineTrackerRead (4);
         LineTrackerRight := LineTrackerRead (10);

         --make decision
         if LineTrackerLeft = True and LineTrackerRight = True then
            Decision := Forward; -- car is on a white line, so drive forward
         end if;

         if LineTrackerLeft = False and LineTrackerRight = True then
            Decision :=
              Right; -- car is left from white line, so drive right to return
         end if;

         if LineTrackerLeft = False and LineTrackerRight = True then
            Decision :=
              Left; -- car is right from white line, so drive left to return
         end if;

         if LineTrackerLeft = False and LineTrackerRight = True then
            Decision := Stop; -- car is in unknown position, so stop
         end if;

         --set drive direction based on sensed values
         MotorDriver.SetDirection (Decision);

         delay until MyClock + Milliseconds (50);
      end loop;
   end LineReading;

   function LineTrackerRead (pin : Pin_Id) return Boolean is
   begin
      return Set (pin);
   end LineTrackerRead;
end TaskSense;
